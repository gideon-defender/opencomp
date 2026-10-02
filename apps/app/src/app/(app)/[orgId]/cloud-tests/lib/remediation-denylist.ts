// Client-side entry point for the remediation denylist.
// The implementation lives in @gideon-defender/utils/remediation-denylist
// (single source of truth shared with the API). The backend re-checks
// server-side — this import only keeps the UI from displaying a script
// that the backend would refuse to grant.
export * from '@gideon-defender/utils/remediation-denylist';
