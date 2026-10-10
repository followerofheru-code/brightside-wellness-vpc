import { test, expect } from 'claude-code/testing'

const PLAN_DESTROY = `
  # aws_vpc.main will be destroyed
  # aws_subnet.a will be destroyed
  # aws_instance.web must be replaced

Plan: 1 to add, 0 to change, 3 to destroy.
`
const PLAN_ADD = 'Plan: 2 to add, 0 to change, 0 to destroy.\n'
const TOOLS = ['Bash', 'PowerShell'] as const

const world = (on: any, out = { exitCode: 0, stdout: PLAN_DESTROY, stderr: '' }) => {
  const argvs: string[][] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    argvs.push([...e.argv])
    return { value: { ...out, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: 'ran', text: 'ran' }))
  return argvs
}

const check = ($: any, command: string, tool = 'Bash') =>
  $.tool.check({ tool, input: { command } })
const call = ($: any, command: string, tool = 'Bash') => $.tool.call({ tool, command })

const BLOCKED = [
  'terraform destroy',
  'terraform -chdir=infra destroy',
  'terraform apply -destroy',
  'terraform apply --destroy',
  'terraform apply -auto-approve',
  'terraform apply --auto-approve=true -var-file=x.tfvars',
  'terraform destroy -auto-approve',
  'tofu destroy',
  'tf destroy',
  'terragrunt run-all destroy',
  'terraform.exe destroy',
  'cd infra && terraform destroy',
  'terraform plan && terraform destroy',
  'terraform apply; terraform destroy',
  'terraform validate | terraform destroy',
  '& "C:\\dev\\bin\\terraform.exe" destroy',
  '$env:AWS_PROFILE="x"; terraform destroy',
  'AWS_PROFILE=x terraform destroy',
  'bash -c "terraform destroy"',
  'cmd /c terraform destroy -auto-approve',
  'powershell -Command "terraform apply -destroy"',
]

for (const tool of TOOLS) {
  test(`${tool}: every destroy variant is denied at tool.check`, async ($, on) => {
    world(on)
    for (const c of BLOCKED) {
      const r = await check($, c, tool)
      expect([c, r.decision]).toEqual([c, 'deny'])
    }
  })

  test(`${tool}: every destroy variant is denied at tool.call`, async ($, on) => {
    world(on)
    for (const c of BLOCKED) {
      const r = await call($, c, tool)
      expect([c, typeof r.deny]).toEqual([c, 'string'])
      expect(r.deny).toContain('terraform-guard blocked')
    }
  })
}

test('the deny carries the plan and tells the model to stop', async ($, on) => {
  const argvs = world(on)
  const r = await call($, 'terraform destroy')
  expect(r.deny).toContain('Plan: 1 to add, 0 to change, 3 to destroy.')
  expect(r.deny).toContain('Destroys: aws_vpc.main, aws_subnet.a')
  expect(r.deny).toContain('Replaces: aws_instance.web')
  expect(r.deny).toContain('Do not retry')
  expect(argvs[0]).toEqual(['terraform', 'plan', '-no-color', '-input=false', '-lock=false', '-destroy'])
})

test('-chdir and cd reach the plan', async ($, on) => {
  const argvs = world(on)
  await call($, 'terraform -chdir=infra destroy')
  expect(argvs[0].slice(0, 3)).toEqual(['terraform', '-chdir=infra', 'plan'])
})

test('a failed plan still denies and names credentials', async ($, on) => {
  world(on, { exitCode: 1, stdout: '', stderr: 'Error: No valid credential sources found' })
  const r = await call($, 'terraform destroy')
  expect(r.deny).toContain('credentials look missing')
})

test('wrapped and aliased commands are denied without a plan', async ($, on) => {
  const argvs = world(on)
  const a = await call($, 'bash -c "terraform destroy"')
  const b = await call($, 'tf destroy')
  expect(a.deny).toContain('wrapped')
  expect(b.deny).toContain('`tf`')
  expect(argvs.length).toBe(0)
})

test('plain apply and state rm ask, with the plan, in every shell tool', async ($, on) => {
  const argvs = world(on, { exitCode: 0, stdout: PLAN_ADD, stderr: '' })
  for (const tool of TOOLS) {
    const a = await check($, 'terraform apply -var-file=brightside-terraform.tfvars', tool)
    expect(a.decision).toBe('ask')
    expect(a.reason).toContain('Plan: 2 to add')
  }
  expect(argvs[0]).toContain('-var-file=brightside-terraform.tfvars')
  const s = await check($, 'terraform state rm aws_vpc.main')
  expect(s.decision).toBe('ask')
  expect(s.reason).toContain('aws_vpc.main')
  const p = await check($, 'terraform apply tfplan')
  expect(p.decision).toBe('ask')
  expect(p.reason).toContain('saved plan file')
})

test('plain apply is not blocked at tool.call', async ($, on) => {
  world(on)
  const r = await call($, 'terraform apply')
  expect(r.deny).toBe(undefined)
})

test('the strictest segment wins in a chain', async ($, on) => {
  world(on, { exitCode: 0, stdout: PLAN_ADD, stderr: '' })
  const r = await check($, 'terraform apply && terraform destroy')
  expect(r.decision).toBe('deny')
})

test('commands that only mention the words pass through', async ($, on) => {
  const argvs = world(on)
  const safe = [
    'terraform plan',
    'terraform plan -destroy',
    'terraform validate',
    'terraform fmt',
    'terraform state list',
    'ls -la',
    'echo terraform destroy',
    'git commit -m "docs: terraform destroy notes"',
    'grep -r "terraform apply" .',
    'cat README.md',
  ]
  for (const c of safe) {
    expect([c, (await check($, c)).decision]).toEqual([c, 'allow'])
    expect([c, (await call($, c)).deny]).toEqual([c, undefined])
  }
  expect(argvs.length).toBe(0)
})

test('tools without a command are ignored', async ($, on) => {
  const argvs = world(on)
  const r = await $.tool.check({ tool: 'Read', input: { file_path: 'x' } })
  expect(r.decision).toBe('allow')
  expect(argvs.length).toBe(0)
})

test('a deny from below is kept and nothing is planned', async ($, on) => {
  const argvs: string[][] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => (argvs.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('tool.check', () => ({ decision: 'deny', reason: 'rule' }))
  const r = await check($, 'terraform destroy')
  expect(r.decision).toBe('deny')
  expect(r.reason).toBe('rule')
  expect(argvs.length).toBe(0)
})
