import type { Register } from 'claude-code'

type Kind = 'destroy' | 'apply' | 'state'

type Risk = {
  kind: Kind
  /** Denied outright: destroy, `apply -destroy`, `apply -auto-approve`. */
  block: boolean
  bin: string
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
  /** Found inside a wrapper (`bash -c "..."`); flags were not parsed. */
  loose: boolean
}

type Run = (
  argv: readonly string[],
  init?: { cwd?: string; timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

const SEPARATORS = /&&|\|\||;|\n/
const BINARY = /^(?:.*[\\/])?(terraform|tofu|tf|terragrunt)(?:\.exe)?$/i
const PASS_THROUGH = /^(?:&|\.|call|command|exec|env|sudo|time|nohup|nice)$/i
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const CD = /^(?:cd|chdir|sl|set-location|pushd)$/i
// Last resort for wrappers (`bash -c "..."`, `cmd /c ...`): the words appear in one segment.
const LOOSE = /\b(terraform|tofu|terragrunt)(?:\.exe)?["']?\s+(?:\S+\s+)*?(destroy|apply)\b/i
// Segments that name the words without running them.
const HARMLESS =
  /^\s*(?:echo|git|grep|rg|cat|type|write-output|write-host|select-string|sls|man|help|ls|dir|gc|get-content|sed|awk)\b/i
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

const segmentRisk = (t: string[], cwd?: string): Risk | undefined => {
  let s = 0
  while (t[s] !== undefined && (PASS_THROUGH.test(t[s]) || ASSIGNMENT.test(t[s]))) s++
  const m = t[s] === undefined ? null : BINARY.exec(t[s])
  if (!m) return undefined
  const bin = m[1].toLowerCase()

  let i = s + 1
  let chdir: string | undefined
  while (t[i]?.startsWith('-chdir=')) chdir = t[i++].slice('-chdir='.length)
  if (bin === 'terragrunt' && t[i] === 'run-all') i++
  const sub = t[i]
  // terraform takes `-flag` and `--flag` alike
  const rest = t.slice(i + 1).map(a => a.replace(/^--/, '-'))

  const base = { bin, cwd, chdir, planArgs: [] as string[], hasPlanFile: false, autoApprove: false, stateArgs: [] as string[], loose: false }
  if (sub === 'state' && (rest[0] === 'rm' || rest[0] === 'mv')) {
    return { ...base, kind: 'state', block: false, stateArgs: rest }
  }
  if (sub !== 'destroy' && sub !== 'apply') return undefined

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
  const kind: Kind = sub === 'destroy' || rest.includes('-destroy') ? 'destroy' : 'apply'
  return { ...base, kind, block: kind === 'destroy' || autoApprove, planArgs, hasPlanFile, autoApprove }
}

export const classify = (command: string): Risk | undefined => {
  let cwd: string | undefined
  const found: Risk[] = []
  const segments = command.split(SEPARATORS).map(s => s.trim())
  for (const raw of segments) {
    const t = tokens(raw)
    if (CD.test(t[0] ?? '') && t[1]) {
      cwd = t[1]
      continue
    }
    const r = segmentRisk(t, cwd)
    if (r) found.push(r)
  }
  const best = found.find(r => r.block) ?? found[0]
  if (best) return best

  for (const raw of segments) {
    if (HARMLESS.test(raw)) continue
    const m = LOOSE.exec(raw)
    if (!m) continue
    const kind: Kind = m[2].toLowerCase() === 'destroy' ? 'destroy' : 'apply'
    const autoApprove = /-auto-approve/.test(raw)
    return {
      kind,
      block: kind === 'destroy' || autoApprove || /\s-destroy\b/.test(raw),
      bin: m[1].toLowerCase(),
      planArgs: [],
      hasPlanFile: false,
      autoApprove,
      stateArgs: [],
      loose: true,
    }
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

const verbOf = (risk: Risk): string =>
  risk.kind === 'state' ? `terraform state ${risk.stateArgs[0]}` : `terraform ${risk.kind}`

/** What the plan says, or why none could be measured. */
const measure = async (run: Run, risk: Risk): Promise<string> => {
  if (risk.kind === 'state') {
    return `It edits the state file only: resources removed with rm stay in AWS but Terraform stops managing them.\nTargets: ${risk.stateArgs.slice(1).join(', ') || '(none given)'}`
  }
  if (risk.hasPlanFile) {
    return 'Applying a saved plan file: it runs exactly what was planned earlier, so I did not re-plan.'
  }
  if (risk.loose) {
    return 'The command is wrapped (bash -c, cmd /c, ...), so its flags were not parsed and no plan was run.'
  }
  if (risk.bin !== 'terraform' && risk.bin !== 'tofu') {
    return `The command uses \`${risk.bin}\`, so no plan was run.`
  }
  const argv = [
    risk.bin,
    ...(risk.chdir ? [`-chdir=${risk.chdir}`] : []),
    'plan',
    '-no-color',
    '-input=false',
    '-lock=false',
    ...(risk.kind === 'destroy' ? ['-destroy'] : []),
    ...risk.planArgs,
  ]
  try {
    const out = await run(argv, { cwd: risk.cwd, timeoutMs: 300_000 })
    if (out.exitCode !== 0) {
      const hint = /credential|ExpiredToken|NoCredentialProviders|SSO/i.test(out.stderr)
        ? ' (AWS credentials look missing or expired)'
        : ''
      return `Plan failed with exit ${out.exitCode}${hint}: ${firstLines(out.stderr, 3)}\nNothing was measured.`
    }
    return `${summarize(out.stdout)}\nMeasured just now with \`plan${risk.kind === 'destroy' ? ' -destroy' : ''}\`; the real run re-plans and can differ.`
  } catch (err) {
    return `Could not run terraform plan: ${String(err).slice(0, 200)}\nNothing was measured.`
  }
}

const blockText = (risk: Risk, body: string): string =>
  `terraform-guard blocked \`${verbOf(risk)}\`${risk.autoApprove ? ' with -auto-approve' : ''}. ` +
  `Destroy, apply -destroy and apply -auto-approve are never run through Claude.\n${body}\n` +
  'Do not retry this or look for a way around it. Tell the user what the plan shows and ask them to run the command themselves in their own terminal.'

const DANGEROUS = /\b(?:terraform|tofu|terragrunt|tf)\b.*\b(?:destroy|auto-approve)\b/i

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    $.ui.toast('terraform-guard loaded')
    return next(e)
  })

  // The gate that holds in every permission mode: a deny here ends the call.
  // No tool matcher: Bash, PowerShell or any shell-like tool carries `command`.
  on('tool.call', async ($, e, next) => {
    const command = commandOf(e)
    const risk = command ? classify(command) : undefined
    if (!risk?.block) return next(e)
    $.ui.toast(`terraform-guard: blocked terraform ${risk.kind}`)
    return { deny: blockText(risk, await measure((argv, init) => $.process.run(argv, init), risk)) }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : DANGEROUS.test(commandOf(e))
        ? { deny: 'terraform-guard failed before it could judge this command, so it was blocked. Ask the user to run it themselves.' }
        : next(e),
  )

  // The dialog for the milder cases (apply, state rm|mv), and a second deny for the blocked ones.
  on('tool.check', async ($, e, next) => {
    const command = commandOf(e.input)
    if (!command) return next(e)

    const base = await next(e)
    if (base.decision === 'deny') return base

    const risk = classify(command)
    if (!risk) return base
    $.ui.toast(`terraform-guard: checking terraform ${risk.kind}`)

    const body = await measure((argv, init) => $.process.run(argv, init), risk)
    if (risk.block) return { decision: 'deny', reason: blockText(risk, body) }
    return { decision: 'ask', reason: `terraform-guard: \`${verbOf(risk)}\` is about to run.\n${body}` }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : /terraform|tofu|terragrunt|\btf\b/i.test(commandOf(e.input))
        ? { decision: 'ask', reason: 'terraform-guard failed before it could judge this command.' }
        : next(e),
  )
}
