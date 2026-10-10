import { test, expect } from 'claude-code/testing'

const PLAN_DESTROY = `
Terraform will perform the following actions:

  # aws_vpc.main will be destroyed
  - resource "aws_vpc" "main" {}

  # aws_subnet.a will be destroyed
  - resource "aws_subnet" "a" {}

  # aws_instance.web must be replaced
-/+ resource "aws_instance" "web" {}

Plan: 1 to add, 0 to change, 3 to destroy.
`

const runs = (on: any, answer: { exitCode: number; stdout: string; stderr: string }) => {
  const argvs: string[][] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    argvs.push([...e.argv])
    return { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  return argvs
}

const check = ($: any, command: string) =>
  $.tool.check({ tool: 'Bash', input: { command } })

test('destroy: plans with -destroy and lists what dies', async ($, on) => {
  const argvs = runs(on, { exitCode: 0, stdout: PLAN_DESTROY, stderr: '' })
  const r = await check($, 'terraform destroy')
  expect(r.decision).toBe('ask')
  expect(argvs[0]).toEqual(['terraform', 'plan', '-no-color', '-input=false', '-lock=false', '-destroy'])
  expect(r.reason).toContain('Plan: 1 to add, 0 to change, 3 to destroy.')
  expect(r.reason).toContain('Destroys: aws_vpc.main, aws_subnet.a')
  expect(r.reason).toContain('Replaces: aws_instance.web')
})

test('apply carries -var-file in both spellings, drops the rest', async ($, on) => {
  const argvs = runs(on, { exitCode: 0, stdout: 'Plan: 2 to add, 0 to change, 0 to destroy.\n', stderr: '' })
  await check($, 'terraform apply -var-file=brightside-terraform.tfvars -parallelism=5')
  await check($, 'terraform apply -var-file brightside-terraform.tfvars -auto-approve')
  expect(argvs[0]).toContain('-var-file=brightside-terraform.tfvars')
  expect(argvs[0]).not.toContain('-parallelism=5')
  expect(argvs[1]).toContain('-var-file')
  expect(argvs[1]).toContain('brightside-terraform.tfvars')
})

test('-auto-approve is called out', async ($, on) => {
  runs(on, { exitCode: 0, stdout: 'No changes. Your infrastructure matches the configuration.\n', stderr: '' })
  const r = await check($, 'terraform apply -auto-approve')
  expect(r.reason).toContain('-auto-approve')
  expect(r.reason).toContain('No changes.')
})

test('a failed plan asks, never allows, and names credentials', async ($, on) => {
  runs(on, { exitCode: 1, stdout: '', stderr: 'Error: No valid credential sources found' })
  const r = await check($, 'terraform destroy')
  expect(r.decision).toBe('ask')
  expect(r.reason).toContain('credentials look missing')
})

test('cd and -chdir are honoured', async ($, on) => {
  const argvs = runs(on, { exitCode: 0, stdout: 'No changes.\n', stderr: '' })
  await check($, 'terraform -chdir=infra apply')
  expect(argvs[0].slice(0, 3)).toEqual(['terraform', '-chdir=infra', 'plan'])
})

test('saved plan file and state rm are not re-planned', async ($, on) => {
  const argvs = runs(on, { exitCode: 0, stdout: '', stderr: '' })
  const a = await check($, 'terraform apply tfplan')
  const s = await check($, 'terraform state rm aws_vpc.main')
  expect(a.decision).toBe('ask')
  expect(s.decision).toBe('ask')
  expect(s.reason).toContain('aws_vpc.main')
  expect(argvs.length).toBe(0)
})

test('other commands pass through untouched', async ($, on) => {
  const argvs = runs(on, { exitCode: 0, stdout: '', stderr: '' })
  for (const c of ['terraform plan', 'terraform validate', 'ls -la', 'echo terraform destroy']) {
    expect((await check($, c)).decision).toBe('allow')
  }
  expect(argvs.length).toBe(0)
})

test('a deny from below is kept and nothing is planned', async ($, on) => {
  const argvs: string[][] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => (argvs.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('tool.check', () => ({ decision: 'deny', reason: 'rule' }))
  const r = await check($, 'terraform destroy')
  expect(r.decision).toBe('deny')
  expect(argvs.length).toBe(0)
})

test('a shell tool other than Bash is guarded too', async ($, on) => {
  const argvs = runs(on, { exitCode: 0, stdout: PLAN_DESTROY, stderr: '' })
  const r = await $.tool.check({ tool: 'PowerShell', input: { command: 'terraform destroy' } })
  expect(r.decision).toBe('ask')
  expect(argvs.length).toBe(1)
})

test('tools without a command are ignored', async ($, on) => {
  const argvs = runs(on, { exitCode: 0, stdout: '', stderr: '' })
  const r = await $.tool.check({ tool: 'Read', input: { file_path: 'x' } })
  expect(r.decision).toBe('allow')
  expect(argvs.length).toBe(0)
})
