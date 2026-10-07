# Runbook: customer remediation detection scripts

## AWS — CloudTrail detection script

For customers with `OpenComp-Remediator-*` roles who want alerting on
remediation-role use (pilot cohort and beyond). Generates the exact CloudShell
script — SNS topic + three EventBridge rules — so support never hand-writes
event patterns and the script cannot drift from the detector source.

### Generate (AWS)

From the repo root:

```bash
pnpm --filter @gideon-defender/integration-platform run generate:remediation-detection-script \
  --email <customer security on-call> [--topic-name <name>] [--partition aws-us-gov]
```

- `--email` (required): the customer's security on-call address, never an
  individual inbox.
- `--partition aws-us-gov`: GovCloud accounts only. Role ARNs use the
  `aws-us-gov` partition throughout.
- Prints the script to stdout. Send it as-is; do not reformat the commands.

### Send (AWS)

1. Paste the script output into the customer reply with the customer docs
   section "Monitoring auto-remediation" (`packages/docs/cloud-tests/aws.mdx`).
2. Remind them to confirm the SNS subscription email before expecting alerts.
3. Triage guidance for incoming alerts lives in the same docs section.

### Source of truth (AWS)

Patterns and Lake queries live in
`packages/integration-platform/src/manifests/aws/remediation-detection.ts`
(tested). If the docs and the generator ever disagree, the generator wins —
fix the docs.

## Azure — Activity Log detection script

For customers with bound `opencomp-remediator-*` service principals who want
alerting on remediator-SP use. Generates the exact Cloud Shell script — email
action group + one Activity Log alert rule per signal and class — so support
never hand-writes alert conditions and the script cannot drift from the
detector source.

### Generate (Azure)

From the repo root:

```bash
pnpm --filter @gideon-defender/integration-platform run generate:azure-remediation-detection-script \
  --email <customer security on-call> --subscription-id <sub> --resource-group <rg> \
  --service Storage:<sp-app-id> [--service Data:<sp-app-id>] [--action-group-name <name>]
```

- `--email` (required): the customer's security on-call address, never an
  individual inbox.
- `--subscription-id` (required): the subscription holding the remediator SPs.
- `--resource-group` (required): the resource group hosting the action group
  and alert rules.
- `--service <Class>:<sp-app-id>` (required, repeatable): one entry per bound
  class SP from the customer's binding map, e.g.
  `Storage:11111111-1111-1111-1111-111111111111`.
- Prints the script to stdout. Send it as-is; do not reformat the commands.

### Send (Azure)

1. Paste the script output into the customer reply with the customer docs
   section "Monitoring auto-remediation" (`packages/docs/cloud-tests/azure.mdx`).
2. Remind them to confirm the action-group verification email before expecting
   alerts.
3. Triage guidance for incoming alerts lives in the same docs section.

### Source of truth (Azure)

Conditions and forensic queries live in
`packages/integration-platform/src/manifests/azure/remediation-detection.ts`
(barrel over `remediation-detection-filters` + `remediation-detection-script`,
tested). If the docs and the generator ever disagree, the generator wins —
fix the docs.
