/**
 * Standalone Cloudflare Worker — daily due-date reminders.
 * Deploy: npm run deploy:cron (set secrets in Cloudflare first; see workers/debtsync-reminders-cron/README.md)
 */

export interface Env {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEBTSYNC_INTERNAL_API_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
}

async function runDueDateRemindersViaSupabase(env: Env): Promise<{ ok: boolean; detail: string }> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceKey) {
    return { ok: false, detail: 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/check_and_send_due_date_reminders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: '{}',
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, detail: `RPC HTTP ${res.status}: ${text.slice(0, 500)}` };
  }

  return { ok: true, detail: text.slice(0, 500) };
}

async function runDueDateRemindersViaHttp(env: Env): Promise<{ ok: boolean; detail: string }> {
  const secret = env.DEBTSYNC_INTERNAL_API_SECRET?.trim();
  const appUrl = (env.NEXT_PUBLIC_APP_URL || 'https://debt-sync.satya-nayak.dev').replace(/\/$/, '');

  if (!secret) {
    return { ok: false, detail: 'Missing DEBTSYNC_INTERNAL_API_SECRET for HTTP fallback' };
  }

  const res = await fetch(`${appUrl}/api/reminders/due-date`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 500)}` };
  }

  return { ok: true, detail: text.slice(0, 500) };
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    let result = await runDueDateRemindersViaSupabase(env);
    if (!result.ok) {
      console.warn('[DebtSync cron] Supabase RPC failed:', result.detail);
      result = await runDueDateRemindersViaHttp(env);
    }

    if (!result.ok) {
      console.error('[DebtSync cron] Failed:', controller.cron, result.detail);
      throw new Error(result.detail);
    }

    console.log('[DebtSync cron] OK:', controller.cron, result.detail);
  },
};
