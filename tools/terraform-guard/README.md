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
- The mod answers `ask`; what happens next belongs to the permission mode. In auto mode a classifier decides (it may deny, and you are not shown the plan). In bypass mode, or when a settings allow rule already covers the command, no dialog may appear. Use permission deny rules for a hard block.
- A `terraform-guard loaded` toast appears at session start. No toast means the module did not load.
- The plan runs with `-lock=false` and needs working AWS credentials.
- This repo's `brightside-terraform.tfvars` is not auto-loaded by Terraform; pass `-var-file=brightside-terraform.tfvars`.

## Test

```powershell
claude plugin test .\tools\terraform-guard
```
