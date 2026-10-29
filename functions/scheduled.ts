/**
 * Cloudflare Pages scheduled handler — daily due-date reminder job.
 * Configure cron in wrangler.toml. Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL on Pages.
 */

interface ScheduledEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEBTSYNC_INTERNAL_API_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
}

async function runDueDateRemindersViaSupabase(env: ScheduledEnv): Promise<{ ok: boolean; detail: string }> {
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

async function runDueDateRemindersViaHttp(env: ScheduledEnv): Promise<{ ok: boolean; detail: string }> {
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

export async function onSchedule(context: { env: ScheduledEnv; cron: string }) {
  const { env, cron } = context;

  let result = await runDueDateRemindersViaSupabase(env);
  if (!result.ok) {
    console.warn('[DebtSync cron] Supabase RPC path failed:', result.detail);
    result = await runDueDateRemindersViaHttp(env);
  }

  if (!result.ok) {
    console.error('[DebtSync cron] Due-date reminders failed:', cron, result.detail);
    return new Response(JSON.stringify({ success: false, error: result.detail }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('[DebtSync cron] Due-date reminders OK:', cron, result.detail);
  return new Response(JSON.stringify({ success: true, cron, detail: result.detail }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
