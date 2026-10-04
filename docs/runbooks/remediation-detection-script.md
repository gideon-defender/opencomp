# Runbook: customer CloudTrail detection script

For customers with `OpenComp-Remediator-*` roles who want alerting on
remediation-role use (pilot cohort and beyond). Generates the exact CloudShell
script — SNS topic + three EventBridge rules — so support never hand-writes
event patterns and the script cannot drift from the detector source.

## Generate

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

## Send

1. Paste the script output into the customer reply with the customer docs
   section "Monitoring auto-remediation" (`packages/docs/cloud-tests/aws.mdx`).
2. Remind them to confirm the SNS subscription email before expecting alerts.
3. Triage guidance for incoming alerts lives in the same docs section.

## Source of truth

Patterns and Lake queries live in
`packages/integration-platform/src/manifests/aws/remediation-detection.ts`
(tested). If the docs and the generator ever disagree, the generator wins —
fix the docs.
