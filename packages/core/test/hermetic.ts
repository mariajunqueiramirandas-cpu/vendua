// Core's suite runs in the environment CI gives it: TEST_DATABASE_URL and nothing else Core reads.
// A developer or cloud shell may carry live integration keys (Google Calendar, Tinyfish, OpenRouter,
// Resend…), seed overrides (SEED_OWNER_*) or deployment switches (VENDUA_*); tests then reach real
// services or see other defaults and fail only there. Every variable Core's source reads is cleared
// before any test loads; a test that needs one sets it itself.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = new Set(['TEST_DATABASE_URL', 'TEST_APP_DATABASE_URL', 'NODE_ENV', 'LOG_LEVEL', 'TZ']);
const src = join(import.meta.dir, '../src');

for (const file of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
  if (!file.endsWith('.ts')) continue;
  for (const [, name] of readFileSync(join(src, file), 'utf8').matchAll(
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
  ))
    if (!KEEP.has(name!)) delete process.env[name!];
}
