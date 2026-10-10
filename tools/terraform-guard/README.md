# terraform-guard

A Claude Code mod. When Claude is about to run `terraform destroy`, `terraform apply`
or `terraform state rm|mv` (or the `tofu` equivalents) through the Bash tool, it runs
`terraform plan` first and puts the result in the permission dialog:
the plan headline, the resources that would be destroyed, and the ones that would be replaced.

It only ever tightens: the verdict is `ask` (or the existing `deny`), never `allow`.
If the plan fails (no AWS credentials, bad config, timeout) it still asks and says so.

## Install (Windows PowerShell, Claude Code 2.1.287 or later)

```powershell
claude plugin validate .\tools\terraform-guard
claude --plugin-dir .\tools\terraform-guard        # one session
```

To keep it (the `tools` folder is a local marketplace named `brightside-tools`):

```powershell
claude plugin marketplace add .\tools
claude plugin install terraform-guard@brightside-tools --scope user
```

## Limits

- Reads the command text; does not parse shell. Misses `eval`, `bash -c`, `$(...)`, scripts that call terraform.
- Plan flags carried over: `-var`, `-var-file`, `-target`, `-replace`, `-chdir`. Anything else is dropped.
- `terraform apply <planfile>` and `state rm|mv` are not re-planned; the dialog says so.
- `bypassPermissions` mode may auto-approve an `ask`. Use permission deny rules for a hard block.
- The plan runs with `-lock=false` and needs working AWS credentials.
- This repo's `brightside-terraform.tfvars` is not auto-loaded by Terraform; pass `-var-file=brightside-terraform.tfvars`.

## Test

```powershell
claude plugin test .\tools\terraform-guard
```
