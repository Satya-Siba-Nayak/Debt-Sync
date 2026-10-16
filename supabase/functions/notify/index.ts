// Supabase Edge Function: notify
// Sends email (Brevo) + background Web Push (VAPID) when DebtSync activity happens.
// Invoked ONLY by Postgres triggers (see migration 023) with a shared secret header.
//
// Required secrets:
//   WEBHOOK_SECRET        random string, must match notification_config.webhook_secret
//   BREVO_API_KEY         Brevo -> SMTP & API -> API Keys
//   EMAIL_FROM            a sender/domain verified in Brevo, e.g. noreply@satya-nayak.dev
//   VAPID_PUBLIC_KEY      \
//   VAPID_PRIVATE_KEY      } web-push VAPID pair
// Optional:
//   EMAIL_FROM_NAME (default "DebtSync"), VAPID_SUBJECT, APP_URL
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Deploy with JWT verification OFF (auth is the shared secret header):
//   supabase functions deploy notify --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const TOMBSTONE_ID = '00000000-0000-0000-0000-000000000001';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') || '';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || '';
const EMAIL_FROM_NAME = Deno.env.get('EMAIL_FROM_NAME') || 'DebtSync';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@satya-nayak.dev';
const APP_URL = (Deno.env.get('APP_URL') || 'https://debt-sync.satya-nayak.dev').replace(/\/$/, '');

const pushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CURRENCY_SYMBOLS: Record<string, string> = {
  inr: '₹',
  usd: '$',
  eur: '€',
  gbp: '£',
  jpy: '¥',
  aud: 'A$',
  cad: 'C$',
  sgd: 'S$',
  aed: 'AED ',
};

function formatAmount(amount: unknown, currency = 'inr'): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const code = (currency || 'inr').toLowerCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code.toUpperCase()} `;
  const digits = code === 'jpy' ? 0 : 2;
  return `${symbol}${n.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  is_shadow: boolean | null;
  notify_email: boolean | null;
}

interface Message {
  title: string;
  body: string;
  url: string;
  tag: string;
  cta: string;
  amountLine?: string;
}

function displayName(p?: Profile | null): string {
  if (!p) return 'Someone';
  return p.full_name?.trim() || p.email?.split('@')[0] || 'Someone';
}

function buildMessage(
  event: string,
  actorName: string,
  debt: any | null,
  details: Record<string, any>,
  recipientIsGhost: boolean
): Message {
  const currency = debt?.currency || details.currency || 'inr';
  const debtAmount = formatAmount(debt?.principal ?? details.principal, currency);
  const eventAmount = formatAmount(details.amount ?? debt?.principal, currency);
  const debtUrl = debt?.id ? `${APP_URL}/transactions?debt=${debt.id}` : `${APP_URL}/transactions`;
  const tagBase = debt?.id || 'general';

  switch (event) {
    case 'debt_inserted': {
      const splitMatch =
        typeof debt?.notes === 'string' ? debt.notes.match(/\[SPLIT:\{[^]*?"title":"([^"]+)"/) : null;
      const splitTitle = splitMatch?.[1];
      const isPending = debt?.status === 'pending';
      const title = splitTitle
        ? `${actorName} split "${splitTitle}" with you`
        : isPending
        ? `New debt request from ${actorName}`
        : `New ledger entry from ${actorName}`;
      return {
        title,
        body: `${actorName} recorded ${debtAmount} with you${isPending ? '. Tap to review and accept.' : '.'}`,
        url: recipientIsGhost ? `${APP_URL}/signup` : debtUrl,
        tag: `debt-${tagBase}`,
        cta: recipientIsGhost ? 'Create account & review' : 'Review in DebtSync',
        amountLine: debtAmount,
      };
    }
    case 'repayment_reported':
      return {
        title: `Repayment of ${eventAmount} reported`,
        body: `${actorName} reported a payment of ${eventAmount}. Verify it to update the balance.`,
        url: debtUrl,
        tag: `payment-${tagBase}`,
        cta: 'Verify repayment',
        amountLine: eventAmount,
      };
    case 'payment_made':
      return {
        title: `${actorName} recorded a payment`,
        body: `A payment of ${eventAmount} was recorded on your shared ledger.`,
        url: debtUrl,
        tag: `payment-${tagBase}`,
        cta: 'View ledger',
        amountLine: eventAmount,
      };
    case 'payment_verified':
      return details.debt_settled
        ? {
            title: 'Debt fully settled 🎉',
            body: `${actorName} verified your payment of ${eventAmount}. This agreement is now settled.`,
            url: debtUrl,
            tag: `settled-${tagBase}`,
            cta: 'View settled agreement',
            amountLine: eventAmount,
          }
        : {
            title: 'Payment verified',
            body: `${actorName} verified your payment of ${eventAmount}.`,
            url: debtUrl,
            tag: `verified-${tagBase}`,
            cta: 'View ledger',
            amountLine: eventAmount,
          };
    case 'payment_disputed':
      return {
        title: 'Repayment disputed',
        body: `${actorName} disputed your reported payment of ${eventAmount}. Open the ledger to resolve it.`,
        url: debtUrl,
        tag: `disputed-${tagBase}`,
        cta: 'Review dispute',
        amountLine: eventAmount,
      };
    case 'debt_accepted':
      return {
        title: 'Agreement accepted',
        body: `${actorName} accepted your debt agreement for ${debtAmount}.`,
        url: debtUrl,
        tag: `accepted-${tagBase}`,
        cta: 'View agreement',
        amountLine: debtAmount,
      };
    case 'debt_declined':
      return {
        title: 'Agreement declined',
        body: `${actorName} declined your debt agreement for ${debtAmount}.`,
        url: debtUrl,
        tag: `declined-${tagBase}`,
        cta: 'View details',
        amountLine: debtAmount,
      };
    case 'debt_pending_edited':
      return {
        title: 'Pending agreement edited',
        body: `${actorName} changed the terms of a pending agreement (${debtAmount}). Please review.`,
        url: debtUrl,
        tag: `edited-${tagBase}`,
        cta: 'Review changes',
        amountLine: debtAmount,
      };
    case 'debt_cancelled_by_creator':
      return {
        title: 'Debt request withdrawn',
        body: `${actorName} withdrew a pending request for ${debtAmount}.`,
        url: `${APP_URL}/transactions`,
        tag: `cancelled-${details.debt_id || tagBase}`,
        cta: 'Open DebtSync',
        amountLine: debtAmount,
      };
    case 'global_share_enabled':
      return {
        title: 'Public link enabled',
        body: `${actorName} enabled a public read-only link on a shared transaction. You can turn it off anytime.`,
        url: debtUrl,
        tag: `share-${tagBase}`,
        cta: 'Manage sharing',
      };
    default:
      return {
        title: 'DebtSync update',
        body: `${actorName} updated a shared transaction.`,
        url: debtUrl,
        tag: `update-${tagBase}`,
        cta: 'Open DebtSync',
      };
  }
}

function buildEmailHtml(name: string, msg: Message, ghostNote: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:28px 10px;background:#f8f9ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#131c28;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #dae3f4;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#004349 0%,#0d5c63 100%);padding:22px;text-align:center;color:#ffffff;">
      <div style="font-size:20px;font-weight:700;letter-spacing:.5px;">DebtSync</div>
      <div style="margin-top:4px;font-size:11px;opacity:.85;text-transform:uppercase;letter-spacing:1px;">Trust &amp; Precision Peer Ledgers</div>
    </div>
    <div style="padding:26px;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#004349;">${escapeHtml(msg.title)}</h2>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">${escapeHtml(msg.body)}</p>
      ${
        msg.amountLine
          ? `<div style="background:#eff4ff;border:1px solid #dae3f4;border-radius:12px;padding:16px;margin:18px 0;">
        <div style="font-size:11px;text-transform:uppercase;color:#6f797a;font-weight:700;">Amount</div>
        <div style="font-size:24px;font-weight:700;color:#004349;margin-top:2px;">${escapeHtml(msg.amountLine)}</div>
      </div>`
          : ''
      }
      ${ghostNote ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#3f484a;">${escapeHtml(ghostNote)}</p>` : ''}
      <div style="text-align:center;margin-top:20px;">
        <a href="${escapeHtml(msg.url)}" style="display:inline-block;background:#004349;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;">${escapeHtml(msg.cta)}</a>
      </div>
    </div>
    <div style="padding:14px 26px;font-size:11px;color:#6f797a;text-align:center;border-top:1px solid #eff4ff;line-height:1.6;">
      Automated notification from DebtSync. Questions? Contact
      <a href="mailto:support@satya-nayak.dev" style="color:#004349;">support@satya-nayak.dev</a>.
    </div>
  </div>
</body></html>`;
}

async function sendEmail(to: Profile, msg: Message, ghost: boolean): Promise<boolean> {
  if (!BREVO_API_KEY || !EMAIL_FROM) return false;
  if (!to.email || to.email.endsWith('@phone.debtsync.local')) return false;
  if (to.notify_email === false) return false;

  const ghostNote = ghost
    ? `You don't have a DebtSync account yet. Sign up with ${to.email} and this record will appear in your ledger automatically.`
    : '';

  let cleanSenderEmail = EMAIL_FROM.trim();
  let cleanSenderName = EMAIL_FROM_NAME.trim() || 'DebtSync';
  const match = cleanSenderEmail.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    cleanSenderName = match[1].trim() || cleanSenderName;
    cleanSenderEmail = match[2].trim();
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: cleanSenderName, email: cleanSenderEmail },
      to: [{ email: to.email, name: displayName(to) }],
      subject: msg.title,
      htmlContent: buildEmailHtml(displayName(to), msg, ghostNote),
      tags: ['debtsync-notification'],
    }),
  });

  if (!res.ok) {
    console.warn('[notify] Brevo error', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

async function sendPush(recipientIds: string[], msg: Message): Promise<number> {
  if (!pushEnabled || recipientIds.length === 0) return 0;

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')
    .in('user_id', recipientIds);

  if (!subs || subs.length === 0) return 0;

  const payload = JSON.stringify({
    title: msg.title,
    body: msg.body,
    url: msg.url,
    tag: msg.tag,
  });

  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high' }
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          dead.push(s.endpoint); // browser unsubscribed / expired
        } else {
          console.warn('[notify] push failed', err?.statusCode, err?.body || err?.message);
        }
      }
    })
  );

  if (dead.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', dead);
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const provided = req.headers.get('x-webhook-secret') || '';
  if (!WEBHOOK_SECRET || !timingSafeEqual(provided, WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const payload = await req.json();
    const event: string = payload.event;
    const actorId: string | null = payload.actor_id || null;
    const details: Record<string, any> = payload.details || {};
    const debtId: string | null = payload.debt_id || details.debt_id || null;

    let debt: any = null;
    if (payload.debt_id) {
      const { data } = await supabase
        .from('debts')
        .select('id, lender_id, borrower_id, created_by, principal, currency, status, notes')
        .eq('id', payload.debt_id)
        .maybeSingle();
      debt = data;
    }

    const lenderId = debt?.lender_id ?? details.lender_id ?? null;
    const borrowerId = debt?.borrower_id ?? details.borrower_id ?? null;

    // The counterparty of whoever acted (for split shares where the creator is
    // neither party, both parties are notified).
    const recipientIds = Array.from(
      new Set([lenderId, borrowerId].filter((id): id is string => Boolean(id)))
    ).filter((id) => id !== actorId && id !== TOMBSTONE_ID);

    if (recipientIds.length === 0 || (!debtId && !lenderId && !borrowerId)) {
      return Response.json({ ok: true, skipped: 'no-recipients' });
    }

    const profileIds = actorId ? [...recipientIds, actorId] : recipientIds;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_shadow, notify_email')
      .in('id', profileIds);

    const byId = new Map<string, Profile>((profiles || []).map((p: Profile) => [p.id, p]));
    const actorName = displayName(actorId ? byId.get(actorId) : null);

    let emailsSent = 0;
    const pushTargets: string[] = [];
    let pushMessage: Message | null = null;

    for (const rid of recipientIds) {
      const recipient = byId.get(rid);
      if (!recipient) continue;

      const ghost = Boolean(recipient.is_shadow);
      const msg = buildMessage(event, actorName, debt, details, ghost);

      if (!ghost) {
        pushTargets.push(rid);
        pushMessage = pushMessage ?? msg;
      }

      try {
        if (await sendEmail(recipient, msg, ghost)) emailsSent++;
      } catch (err) {
        console.warn('[notify] email failed', err);
      }
    }

    const pushSent = pushMessage ? await sendPush(pushTargets, pushMessage) : 0;

    return Response.json({ ok: true, event, emailsSent, pushSent });
  } catch (err: any) {
    console.error('[notify] error', err);
    // 200 so pg_net never retries/pollutes; the failure is in function logs.
    return Response.json({ ok: false, error: err?.message || 'unknown' });
  }
});
