# terraform-guard

A Claude Code mod that keeps Claude from running destructive Terraform on its own.
It looks at every shell command Claude is about to run (the Bash tool, the PowerShell tool,
or any tool whose input carries a `command`) and acts on `terraform`, `tofu`, `terragrunt` and `tf`.

| Command | Verdict |
|---|---|
| `destroy`, `apply -destroy`, `apply -auto-approve` | **Denied.** The reason carries a fresh `terraform plan` summary and tells the model to stop and ask you to run it yourself. |
| `apply`, `state rm`, `state mv` | **Ask**, with the plan summary in the permission dialog. |
| `plan`, `validate`, `fmt`, `state list`, anything else | Untouched. |

The deny is enforced in a `tool.call` hook, so it holds in every permission mode (auto, bypass,
default). `tool.check` repeats it and supplies the dialog for the `ask` cases.
If the plan cannot be run (no AWS credentials, timeout) the verdict is unchanged and says so.

Recognised forms: `-chdir=dir`, `--flag` spellings, `cd dir && ...`, chains with `&&` `||` `;` `|`,
a leading `&`, `VAR=x`, `$env:X=...;`, `terraform.exe`, full paths, `terragrunt run-all`, and the
words inside `bash -c "..."`, `cmd /c ...` or `powershell -Command "..."` (denied without a plan,
because the flags are not parsed). Commands that merely mention the words
(`echo`, `git commit -m`, `grep`, `cat`, ...) pass through.

A `terraform-guard loaded` toast appears at session start. No toast means the module did not load.

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

## Backup: settings deny rules

Deny rules in `~/.claude/settings.json` apply in auto mode too and do not depend on the plugin loading.
They are prefix matches, so they miss `-chdir`, chains and wrappers; the mod covers those.

```json
"permissions": {
  "deny": [
    "Bash(terraform destroy:*)",
    "PowerShell(terraform destroy:*)"
  ]
}
```

## Limits

- Reads command text; it does not run a shell. Misses variable-built commands, `eval` of
  assembled strings, scripts that call terraform, and a user-defined alias other than `tf`.
- Blocking `apply -auto-approve` means Claude cannot apply unattended either. Run those yourself.
- Plan flags carried over: `-var`, `-var-file`, `-target`, `-replace`, `-chdir`. Anything else is dropped.
- `apply <planfile>` and `state rm|mv` are not re-planned; the dialog says so.
- The `ask` cases go to the permission mode's decider: you in default mode, a classifier in auto
  mode (it may deny, and you are not shown the plan). Only the deny cases are mode-proof.
- The plan runs with `-lock=false` and needs working AWS credentials.
- This repo's `brightside-terraform.tfvars` is not auto-loaded by Terraform; pass
  `-var-file=brightside-terraform.tfvars` or rename it to `brightside.auto.tfvars`.

## Test

```powershell
claude plugin test .\tools\terraform-guard
```
