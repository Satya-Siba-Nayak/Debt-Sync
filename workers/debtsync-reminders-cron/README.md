# Due-date reminder cron (Cloudflare Worker)

Pages **cannot** use `[triggers]` in `wrangler.toml`. This Worker runs on a schedule instead.

## One-time setup

1. Install Wrangler if needed: `npm install -g wrangler` (or use `npx wrangler`).
2. Log in: `npx wrangler login`
3. From repo root, set the same secrets as your Pages project:

```bash
cd workers/debtsync-reminders-cron
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put DEBTSYNC_INTERNAL_API_SECRET
npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
# optional fallback URL for HTTP path
npx wrangler secret put NEXT_PUBLIC_APP_URL
```

4. Deploy:

```bash
npm run deploy:cron
```

5. In **Workers & Pages → debtsync-reminders-cron → Settings → Triggers**, confirm cron `30 3 * * *` (09:00 IST).

## What it does

Calls Supabase RPC `check_and_send_due_date_reminders` daily; falls back to your protected Pages API if RPC fails.
