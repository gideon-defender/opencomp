// Test-only default so tests that render unsubscribe links (email templates)
// see a stable signing secret. Existing process vars win — this never overrides.
if (!process.env.UNSUBSCRIBE_SECRET && !process.env.AUTH_SECRET) {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret';
}
