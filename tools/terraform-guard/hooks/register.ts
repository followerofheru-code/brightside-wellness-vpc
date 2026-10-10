import type { Register } from 'claude-code'

type Kind = 'destroy' | 'apply' | 'state'

type Risk = {
  kind: Kind
  /** Working directory set by an earlier `cd` in the same command line. */
  cwd?: string
  /** Value of the global `-chdir=` option. */
  chdir?: string
  /** Flags to carry from the risky command to `terraform plan`. */
  planArgs: string[]
  /** `terraform apply <planfile>`: the plan is fixed, so re-planning is moot. */
  hasPlanFile: boolean
  autoApprove: boolean
  stateArgs: string[]
}

const SEPARATORS = /&&|\|\||;|\n/
const BINARY = /^(?:.*[\\/])?(terraform|tofu)(?:\.exe)?$/i
// Flags `plan` shares with `apply`/`destroy`; each takes a value.
const CARRIED = new Set(['-var', '-var-file', '-target', '-replace'])
// Flags with a separate value, so the value is not mistaken for a plan file.
const TAKES_VALUE = new Set([
  ...CARRIED,
  '-parallelism',
  '-state',
  '-state-out',
  '-backup',
  '-lock-timeout',
])

const tokens = (segment: string): string[] =>
  (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(t => t.replace(/^["']|["']$/g, ''))

export const classify = (command: string): Risk | undefined => {
  let cwd: string | undefined
  for (const raw of command.split(SEPARATORS)) {
    const t = tokens(raw.trim())
    if (t[0] === 'cd' && t[1]) {
      cwd = t[1]
      continue
    }
    if (t.length === 0 || !BINARY.test(t[0])) continue

    let i = 1
    let chdir: string | undefined
    while (t[i]?.startsWith('-chdir=')) chdir = t[i++].slice('-chdir='.length)
    const sub = t[i]
    const rest = t.slice(i + 1)

    if (sub === 'state' && (rest[0] === 'rm' || rest[0] === 'mv')) {
      return { kind: 'state', cwd, chdir, planArgs: [], hasPlanFile: false, autoApprove: false, stateArgs: rest }
    }
    if (sub !== 'destroy' && sub !== 'apply') continue

    const planArgs: string[] = []
    let hasPlanFile = false
    let autoApprove = false
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j]
      const name = a.split('=')[0]
      if (a === '-auto-approve' || a === '-auto-approve=true') autoApprove = true
      if (CARRIED.has(name)) {
        planArgs.push(a)
        if (!a.includes('=') && rest[j + 1] !== undefined) planArgs.push(rest[++j])
      } else if (TAKES_VALUE.has(name)) {
        if (!a.includes('=')) j++
      } else if (!a.startsWith('-')) {
        hasPlanFile = true
      }
    }
    return { kind: sub, cwd, chdir, planArgs, hasPlanFile, autoApprove, stateArgs: [] }
  }
  return undefined
}

const CHANGE = /^\s+# (.+?) (will be created|will be destroyed|must be replaced|will be updated in-place)/
const SHOWN = 12

export const summarize = (out: string): string => {
  const lines = out.split('\n')
  const headline =
    lines.find(l => /^Plan: /.test(l)) ??
    lines.find(l => /^No changes\./.test(l)) ??
    'No "Plan:" line found in the plan output.'
  const groups: Record<string, string[]> = {}
  for (const l of lines) {
    const m = CHANGE.exec(l)
    if (m) (groups[m[2]] ??= []).push(m[1])
  }
  const list = (label: string, key: string) => {
    const items = groups[key]
    if (!items?.length) return []
    const shown = items.slice(0, SHOWN).join(', ')
    return [`${label}: ${shown}${items.length > SHOWN ? `, and ${items.length - SHOWN} more` : ''}`]
  }
  return [
    headline.trim(),
    ...list('Destroys', 'will be destroyed'),
    ...list('Replaces', 'must be replaced'),
  ].join('\n')
}

const firstLines = (text: string, n: number): string =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(' ')

const commandOf = (input: unknown): string =>
  typeof (input as { command?: unknown })?.command === 'string'
    ? (input as { command: string }).command
    : ''

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    $.ui.toast('terraform-guard loaded')
    return next(e)
  })

  // No tool matcher: Bash, PowerShell or any shell-like tool carries `command`.
  on('tool.check', async ($, e, next) => {
    const command = commandOf(e.input)
    if (!command) return next(e)

    const base = await next(e)
    if (base.decision === 'deny') return base

    const risk = classify(command)
    if (!risk) return base
    $.ui.toast(`terraform-guard: checking terraform ${risk.kind}`)

    const name = `terraform-guard`
    const verb =
      risk.kind === 'state' ? `terraform state ${risk.stateArgs[0]}` : `terraform ${risk.kind}`
    const head = `${name}: \`${verb}\` is about to run${risk.autoApprove ? ' with -auto-approve (no further prompt from Terraform)' : ''}.`

    if (risk.kind === 'state') {
      return {
        decision: 'ask',
        reason: `${head}\nIt edits the state file only: resources removed with rm stay in AWS but Terraform stops managing them.\nTargets: ${risk.stateArgs.slice(1).join(', ') || '(none given)'}`,
      }
    }
    if (risk.hasPlanFile) {
      return {
        decision: 'ask',
        reason: `${head}\nApplying a saved plan file: it runs exactly what was planned earlier, so I did not re-plan.`,
      }
    }

    const argv = [
      'terraform',
      ...(risk.chdir ? [`-chdir=${risk.chdir}`] : []),
      'plan',
      '-no-color',
      '-input=false',
      '-lock=false',
      ...(risk.kind === 'destroy' ? ['-destroy'] : []),
      ...risk.planArgs,
    ]
    try {
      const out = await $.process.run(argv, { cwd: risk.cwd, timeoutMs: 300_000 })
      if (out.exitCode !== 0) {
        const hint = /credential|ExpiredToken|NoCredentialProviders|SSO/i.test(out.stderr)
          ? ' (AWS credentials look missing or expired)'
          : ''
        return {
          decision: 'ask',
          reason: `${head}\nPlan failed with exit ${out.exitCode}${hint}: ${firstLines(out.stderr, 3)}\nNothing was measured. Proceed only if you know why it fails.`,
        }
      }
      return {
        decision: 'ask',
        reason: `${head}\n${summarize(out.stdout)}\nMeasured just now with \`plan${risk.kind === 'destroy' ? ' -destroy' : ''}\`; the real run re-plans and can differ.`,
      }
    } catch (err) {
      return {
        decision: 'ask',
        reason: `${head}\nCould not run terraform plan: ${String(err).slice(0, 200)}\nNothing was measured.`,
      }
    }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : /terraform|tofu/i.test(commandOf(e.input))
        ? { decision: 'ask', reason: 'terraform-guard failed before it could judge this command.' }
        : next(e),
  )
}
