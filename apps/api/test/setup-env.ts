// Loads apps/api/.env for local jest runs so value-level imports (e.g. the
// generated @db client) see the same DATABASE_URL that CI injects via the
// workflow environment. Existing process vars win — this never overrides.
import 'dotenv/config';

// Test-only default so specs that transitively import auth.server.ts (which
// validates SECRET_KEY at module load) run under CI, where no .env exists.
// Existing process vars win — this never overrides.
if (!process.env.SECRET_KEY) {
  process.env.SECRET_KEY = 'test-secret-key-16-chars-min';
}

// Test-only default so specs that render unsubscribe links (email templates)
// see a stable signing secret. Existing process vars win — this never overrides.
if (!process.env.UNSUBSCRIBE_SECRET && !process.env.AUTH_SECRET) {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret';
}
