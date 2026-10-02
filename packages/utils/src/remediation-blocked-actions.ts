/**
 * Exact `service:Action` values that must never be auto-granted.
 *
 * Imported by `./remediation-denylist` (the single source of truth both the
 * API and the web app re-export). Kept in its own module so the logic file
 * stays under the 300-line limit — edit the list here, never by copying it
 * elsewhere.
 *
 * Grouping rule: an action lands here when it is a pure disable / expose /
 * execute primitive with no narrow fix-forward use. Dual-use configuration
 * actions that ARE the fix mechanism itself (`cloudtrail:UpdateTrail`,
 * `config:PutConfigurationRecorder`, `network-firewall:UpdateLoggingConfiguration`)
 * stay allowed — blocking them would end auto-remediation for those finding
 * classes. Misuse of those requires a fooled model AND a user approving the
 * visible plan; misuse of the actions below requires only the grant.
 */

/** Exact `service:Action` values that must never be auto-granted. */
export const BLOCKED_REMEDIATION_ACTIONS: ReadonlySet<string> = new Set([
  // IAM privilege escalation (also covered by the generic IAM rule in the
  // denylist module — listed explicitly so audits grepping for these find them).
  'iam:CreateRole',
  'iam:PutRolePolicy',
  'iam:PassRole',
  'iam:CreateServiceLinkedRole',
  'iam:DeleteRole',
  'iam:DeleteRolePolicy',
  'iam:AttachRolePolicy',
  'iam:DetachRolePolicy',
  'iam:UpdateAssumeRolePolicy',
  'iam:CreatePolicy',
  'iam:CreatePolicyVersion',
  'iam:DeletePolicy',
  'iam:DeleteAccountPasswordPolicy',
  // Public-exposure / exfiltration vectors (resource-policy grants that open
  // data or invoke to other principals — same shape as the blocked sqs/events
  // vectors, so the siblings are blocked too).
  's3:PutBucketPolicy',
  's3:PutBucketAcl',
  's3:PutObjectAcl',
  's3:CreateBucket',
  's3:PutAccountPublicAccessBlock',
  's3:PutReplicationConfiguration',
  's3:PutAccessPointPolicy',
  's3:CreateAccessPoint',
  'kms:PutKeyPolicy',
  'kms:CreateGrant',
  'kms:CreateKey',
  'kms:RetireGrant',
  'sns:Subscribe',
  'sns:AddPermission',
  // Data-send primitives: the actual exfiltration (publishing account state
  // outward), not just the setup. No documented fix publishes a topic,
  // sends a queue message, emits an event-bus event, or routes object
  // events to an attacker destination.
  'sns:Publish',
  'sqs:SendMessage',
  'events:PutEvents',
  's3:PutBucketNotification',
  'sqs:AddPermission',
  'events:PutPermission',
  'events:PutRule',
  'events:PutTargets',
  'lambda:AddPermission',
  'ecr:SetRepositoryPolicy',
  'secretsmanager:PutResourcePolicy',
  // Snapshot / AMI sharing: the classic cross-account exfil primitive
  // (Modify*SnapshotAttribute / ModifyImageAttribute make data copyable by
  // another account). No documented fix shares a snapshot or image.
  'rds:ModifyDBSnapshotAttribute',
  'rds:ModifyDBClusterSnapshotAttribute',
  'ec2:ModifySnapshotAttribute',
  'ec2:ModifyImageAttribute',
  // Snapshot / table export to attacker S3: same exfil shape through the
  // export path rather than the share-attribute path. No documented fix
  // exports a snapshot or table.
  'rds:StartExportTask',
  'dynamodb:ExportTableToPointInTime',
  // Traffic reroute: DNS record swap and LB listener / target-group
  // rewrite redirect traffic without any Authorize/Delete verb for the
  // generic rule to catch. Same shape as the EC2 route/SG entries above,
  // one service over. No documented fix changes records, listeners, or
  // target groups.
  // NOTE: `cloudfront:UpdateDistribution` is deliberately NOT listed — it
  // IS the fix mechanism for the CloudFront finding classes (HTTPS
  // redirect, WAF attach, logging; see cloudfront.adapter.ts) and the
  // static setup script grants it. Same accepted risk as `UpdateTrail`:
  // misuse needs a fooled model AND an approving user on a visible plan.
  'route53:ChangeResourceRecordSets',
  'elbv2:ModifyListener',
  'elbv2:ModifyTargetGroup',
  // Creation-side siblings of the modify path above: a new listener or
  // target group (plus registering targets into it) reroutes traffic
  // without touching a blocked verb. No documented fix creates them.
  'elbv2:CreateListener',
  'elbv2:CreateTargetGroup',
  'elbv2:RegisterTargets',
  // Cost / resilience.
  'shield:CreateSubscription',
  'backup:DeleteBackupPlan',
  // Destructive verbs not covered by the generic verb rule below.
  'kms:ScheduleKeyDeletion',
  'sqs:PurgeQueue',
  // SSM RCE surface: Create*/Update*/Delete* manage documents, but
  // SendCommand / StartSession / StartAutomationExecution ARE the execution
  // primitives — a generated "fix" must never grant them.
  // Attacker-controlled parameter values flow into commands and prompts —
  // reads stay blocked alongside the execution primitives below.
  'ssm:PutParameter',
  'ssm:CreateDocument',
  'ssm:UpdateDocument',
  'ssm:DeleteDocument',
  'ssm:UpdateDocumentDefaultVersion',
  'ssm:ResetServiceSetting',
  // Account-wide SSM mutation with no narrow fix use. The rollback
  // validators refuse `UpdateServiceSettingCommand` wholesale, so a grant
  // here could never serve a legitimate step — only widen the role.
  'ssm:UpdateServiceSetting',
  'ssm:SendCommand',
  'ssm:StartSession',
  // Same interactive-shell primitive through a different verb: resuming a
  // session is shell access without StartSession for the eye to catch.
  'ssm:ResumeSession',
  'ssm:StartAutomationExecution',
  // Detector disable-via-update: UpdateDetector takes `Enable: false`, which
  // silently blinds GuardDuty without any Delete/Disable/Stop verb for the
  // generic rule to catch. Detector creation stays allowed via
  // CreateDetector; config changes go to manual review. Per-member and
  // publishing-destination updates blind detection the same way, so the
  // siblings are listed too (a service-scoped `guardduty:Update*` rule in
  // the denylist module backstops future additions).
  'guardduty:UpdateDetector',
  'guardduty:UpdateMemberDetectors',
  'guardduty:UpdatePublishingDestination',
  'guardduty:UpdateOrganizationConfiguration',
  'guardduty:UpdateFilter',
  'guardduty:UpdateIPSet',
  'guardduty:UpdateThreatIntelSet',
  // Trail-blinding via selector/update verbs the generic rule misses.
  // `UpdateTrail` itself stays allowed — it IS the fix mechanism, guarded
  // per-parameter — but narrowing event selectors or the event data store
  // is never a fix.
  'cloudtrail:PutEventSelectors',
  'cloudtrail:UpdateEventDataStore',
  // Network-fabric mutation: swapping security groups or rewriting routes
  // reroutes or exposes traffic without any Authorize/Delete verb.
  // Read-only inspection and the EBS-encryption fixes stay allowed.
  'ec2:ModifyInstanceAttribute',
  // ENI security-group swap: same traffic-rerouting outcome as the instance
  // attribute path, through the network-interface modifier.
  'ec2:ModifyNetworkInterfaceAttribute',
  'ec2:CreateRoute',
  'ec2:ReplaceRoute',
  // Group-rule mutation without the `Authorize` verb the generic rule
  // blocks — same open-ingress outcome through the modify path.
  'ec2:ModifySecurityGroupRules',
  'ec2:UpdateSecurityGroupRuleDescriptionsIngress',
  'ec2:UpdateSecurityGroupRuleDescriptionsEgress',
  'ec2:ModifyVpcAttribute',
  'ec2:ModifySubnetAttribute',
  // Compute / workflow mutation (code execution, infra changes).
  // Execution primitives stay blocked: launching compute with attacker
  // controlled user data or code is RCE shaped, never a fix.
  'ec2:RunInstances',
  // Stopped-instance start: same unauthorized-compute/cost shape as Run
  // through a verb the generic rule does not cover.
  'ec2:StartInstances',
  'lambda:InvokeFunction',
  'states:StartExecution',
  'ecs:RunTask',
  'ecs:StartTask',
  'batch:SubmitJob',
  'lambda:UpdateFunctionConfiguration',
  // Code deploy is RCE-shaped and never a fix — configuration edits stay
  // blocked alongside it; removal/creation siblings were already listed.
  'lambda:UpdateFunctionCode',
  'lambda:RemovePermission',
  'lambda:CreateFunction',
  'lambda:DeleteFunction',
  'codebuild:UpdateProject',
  'states:UpdateStateMachine',
  'states:DeleteStateMachine',
  // Data-plane weakening / outage-inducing.
  'eks:UpdateClusterConfig',
  'rds:ModifyDBInstance',
  'rds:ModifyDBCluster',
  'es:UpdateDomainConfig',
  'secretsmanager:RotateSecret',
  'sagemaker:StartNotebookInstance',
  'sagemaker:StopNotebookInstance',
  'sagemaker:UpdateNotebookInstance',
  'sagemaker:DeleteNotebookInstance',
  'cognito-idp:UpdateUserPool',
  'cognito-idp:DeleteUserPool',
  'wafv2:UpdateWebACL',
  'wafv2:DeleteWebACL',
  // Detaching a WebACL blinds protection with no blocked verb — same
  // kill-switch shape as the delete path. Attaching stays allowed: it only
  // ever adds protection, never removes it.
  'wafv2:DisassociateWebACL',
  // Volume/network detachment: same disable-by-detach shape through EC2.
  'ec2:DetachVolume',
  'ec2:DetachInternetGateway',
  'elasticbeanstalk:UpdateEnvironment',
  // Secret-plaintext reads: values land in previousState (persisted to the
  // action row) and in model context. Documented fixes need Describe*/list
  // reads, never plaintext — a fooled read step plus a one-click grant must
  // not pull secrets into the DB, logs, or the next prompt.
  'secretsmanager:GetSecretValue',
  // Secret writes: persisting or rotating attacker-shaped values through
  // the role. Same reason as the reads above — secret material must stay
  // out of the loop. (`DeleteSecret` is covered by the generic Delete verb;
  // listed here in spirit, enforced there.)
  'secretsmanager:PutSecretValue',
  'secretsmanager:CreateSecret',
  'secretsmanager:UpdateSecret',
  'ssm:GetParameter',
  'ssm:GetParameters',
  'ssm:GetParametersByPath',
  'kms:Decrypt',
]);
