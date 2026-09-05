# Operations

Local preparation for production monitoring and recovery. Enabling cloud
services remains a separate release step.

## Monitoring

- Probe `GET /api/health` every five minutes. It returns `200 {"status":"ok"}`
  only when the application can query its configured database; failures return
  503 without exposing provider or database details.
- Use Vercel for deployment status, function duration, and platform logs.
- Use Sentry for uncaught application errors and release correlation once its
  project and DSN are approved.
- Alert on repeated calendar authorization failures, events entering
  `action_required`, SES bounce/complaint events, and any failed backup run.
- Never include invite tokens, OAuth codes, access tokens, refresh tokens, email
  bodies, or full participant addresses in monitoring payloads.

## Turso recovery layers

Turso creates point-in-time recovery data automatically at commit. The current
Developer plan retains 10 days. A PITR restore creates a new database, so the
application URL and token must be changed after validation.

Keep a second, provider-independent layer as a daily logical dump:

```bash
npm run db:backup -- get2gethr-production /secure/get2gethr-backups
```

The command:

1. obtains a Turso `.dump` through the authenticated Turso CLI;
2. restores it into a temporary local SQLite database;
3. runs `PRAGMA integrity_check`;
4. writes a gzip archive and SHA-256 manifest with owner-only permissions.

Store the resulting archives in an encrypted bucket with object versioning and
a lifecycle policy. Keep 14 daily and 12 monthly copies. Run a full recovery
drill quarterly: restore to a new Turso database, run migrations and smoke
checks against it, then destroy the temporary database after recording the
result. Never test a restore by overwriting production.

## PITR command pattern

```bash
turso db create get2gethr-recovery-YYYYMMDD \
  --from-db get2gethr-production \
  --timestamp 2026-09-01T00:00:00Z
```

The restored database needs a fresh token. Validate it before changing any
Vercel environment variable.
