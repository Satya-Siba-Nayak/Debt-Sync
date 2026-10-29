// Supabase Edge Function: notify
// Sends email (Brevo) + background Web Push (VAPID) when DebtSync activity happens.
// Enforces 5 emails/user/24h quota limit to conserve Brevo free tier (~300/day).
// Supports RFC-compliant one-click unsubscribe.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const TOMBSTONE_ID = '00000000-0000-0000-0000-000000000001';
const MAX_EMAILS_PER_USER_24H = 5;
const MAX_GLOBAL_EMAILS_24H = 250; // Guard headroom for Brevo 300/day quota

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

async function getUnsubscribeHmac(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretMaterial = WEBHOOK_SECRET || SERVICE_KEY;
  if (!secretMaterial) {
    throw new Error('Missing cryptographic secret for unsubscribe HMAC.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`unsub:${userId}`));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

async function createUnsubscribeUrl(userId: string): Promise<string> {
  const sig = await getUnsubscribeHmac(userId);
  return `${SUPABASE_URL}/functions/v1/notify?action=unsubscribe&uid=${encodeURIComponent(userId)}&sig=${sig}`;
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
        typeof debt?.notes === 'string' && debt.notes.includes('[SPLIT:');
      if (splitMatch) {
        return {
          title: `${actorName} split an expense with you`,
          body: `${actorName} added you to a shared expense split on DebtSync.`,
          amountLine: debtAmount,
          url: debtUrl,
          tag: `debt-${tagBase}-created`,
          cta: 'Review Split Share',
        };
      }
      return {
        title: `${actorName} recorded a transaction with you`,
        body: recipientIsGhost
          ? `${actorName} recorded a ${debtAmount} transaction with your contact info.`
          : `${actorName} recorded a ${debtAmount} agreement on your shared ledger.`,
        amountLine: debtAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-created`,
        cta: recipientIsGhost ? 'Sign Up to Review & Accept' : 'Review Agreement',
      };
    }
    case 'repayment_reported':
    case 'payment_made':
      return {
        title: `Repayment of ${eventAmount} reported`,
        body: `${actorName} reported a repayment of ${eventAmount}. Please review and verify the receipt.`,
        amountLine: eventAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-repayment`,
        cta: 'Verify Repayment',
      };
    case 'payment_verified':
      return {
        title: `Payment verified (${eventAmount})`,
        body: `${actorName} verified your repayment of ${eventAmount}. Your ledger has been updated.`,
        amountLine: eventAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-verified`,
        cta: 'View Updated Balance',
      };
    case 'payment_disputed':
      return {
        title: `Repayment disputed by ${actorName}`,
        body: `${actorName} marked a reported payment of ${eventAmount} as disputed. Please check the transaction details.`,
        amountLine: eventAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-disputed`,
        cta: 'Review Disputed Payment',
      };
    case 'debt_accepted':
      return {
        title: `Transaction agreement accepted`,
        body: `${actorName} accepted the transaction agreement of ${debtAmount}.`,
        amountLine: debtAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-accepted`,
        cta: 'Open Shared Ledger',
      };
    case 'debt_declined':
      return {
        title: `Transaction agreement declined`,
        body: `${actorName} declined the proposed transaction agreement of ${debtAmount}.`,
        amountLine: debtAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-declined`,
        cta: 'View Status',
      };
    case 'debt_pending_edited':
      return {
        title: `Transaction terms updated`,
        body: `${actorName} adjusted the pending terms for this transaction. Please review the updated balance and interest terms.`,
        amountLine: debtAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-edited`,
        cta: 'Review Updated Terms',
      };
    case 'debt_cancelled_by_creator':
      return {
        title: `Pending request cancelled`,
        body: `${actorName} cancelled the pending transaction request of ${debtAmount}.`,
        amountLine: debtAmount,
        url: `${APP_URL}/transactions`,
        tag: `debt-${tagBase}-cancelled`,
        cta: 'View Transactions',
      };
    case 'global_share_enabled':
      return {
        title: `Public share link enabled by ${actorName}`,
        body: `${actorName} enabled public view link sharing for your transaction of ${debtAmount}.`,
        amountLine: debtAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-share`,
        cta: 'View Transaction',
      };
    case 'debt_pending_reminder':
      return {
        title: `Reminder: Pending agreement from ${actorName}`,
        body: recipientIsGhost
          ? `${actorName} sent a friendly reminder to review and respond to the pending ${debtAmount} agreement on DebtSync.`
          : `${actorName} sent a friendly reminder to review and respond to the pending ${debtAmount} agreement on your shared ledger.`,
        amountLine: debtAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-reminder`,
        cta: recipientIsGhost ? 'Sign Up to Review & Accept' : 'Review Agreement',
      };
    case 'payment_reminder':
      return {
        title: `Payment Reminder: ${eventAmount} to ${actorName}`,
        body: recipientIsGhost
          ? `${actorName} sent a friendly payment reminder for ${eventAmount} on DebtSync.`
          : `${actorName} sent a friendly payment reminder regarding the outstanding balance of ${eventAmount} on your shared ledger.`,
        amountLine: eventAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-payment-reminder`,
        cta: recipientIsGhost ? 'Sign Up to Repay' : 'View & Submit Repayment',
      };
    case 'due_date_reminder': {
      const dueStr = debt?.due_date
        ? new Date(debt.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : 'tomorrow';
      return {
        title: `Payment Due Tomorrow (${debtAmount})`,
        body: `Friendly reminder: Your payment of ${debtAmount} to ${actorName} is due tomorrow (${dueStr}).`,
        amountLine: debtAmount,
        url: debtUrl,
        tag: `debt-${tagBase}-due-date-reminder`,
        cta: 'View & Submit Repayment',
      };
    }
    default:
      return {
        title: `Ledger update from ${actorName}`,
        body: `New activity recorded on your shared ledger by ${actorName}.`,
        url: debtUrl,
        tag: `debt-${tagBase}-update`,
        cta: 'Open DebtSync',
      };
  }
}

function buildEmailHtml(
  name: string,
  msg: Message,
  ghostNote: string,
  unsubUrl: string,
  ghostInfo?: { email: string; signupUrl: string; loginUrl: string } | null
): string {
  const effectiveCtaUrl = ghostInfo ? ghostInfo.signupUrl : msg.url;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark only">
  <meta name="supported-color-schemes" content="dark only">
  <title>${escapeHtml(msg.title)}</title>
  <style>
    :root {
      color-scheme: dark only;
      supported-color-schemes: dark only;
    }
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: #080e18 !important;
      color: #dae3f4 !important;
    }
    @media only screen and (max-width: 600px) {
      .email-wrapper {
        padding: 16px 8px !important;
      }
      .email-container {
        border-radius: 14px !important;
      }
      .email-content {
        padding: 22px 18px !important;
      }
      .amount-headline {
        font-size: 22px !important;
      }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#080e18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#dae3f4;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#080e18;" class="email-wrapper">
    <tr>
      <td align="center" style="padding:28px 10px;">
        <div style="max-width:520px;width:100%;background-color:#111927;border-radius:18px;border:1px solid #1f2d42;overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,0.5);" class="email-container">
          
          <!-- Brand Header -->
          <div style="background:linear-gradient(135deg,#002a2e 0%,#004349 55%,#006067 100%);background-color:#004349;padding:24px 20px;text-align:center;border-bottom:1px solid #005a63;">
            <div style="font-size:22px;font-weight:800;letter-spacing:0.8px;color:#ffffff;text-shadow:0 2px 4px rgba(0,0,0,0.3);">DebtSync</div>
            <div style="margin-top:5px;font-size:11px;color:#67e8f9;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">Trust &amp; Precision Peer Ledgers</div>
          </div>

          <!-- Body Content -->
          <div style="padding:28px 24px;text-align:left;" class="email-content">
            <h2 style="margin:0 0 14px;font-size:19px;font-weight:700;color:#22d3ee;letter-spacing:-0.2px;line-height:1.35;">${escapeHtml(msg.title)}</h2>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#f1f5f9;">Hi ${escapeHtml(name)},</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#cbd5e1;">${escapeHtml(msg.body)}</p>

            ${
              msg.amountLine
                ? `<div style="background-color:#162234;border:1px solid #253750;border-radius:14px;padding:18px 20px;margin:20px 0;">
              <div style="font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700;letter-spacing:1px;">Transaction Amount</div>
              <div style="font-size:26px;font-weight:800;color:#22d3ee;margin-top:4px;letter-spacing:-0.5px;" class="amount-headline">${escapeHtml(msg.amountLine)}</div>
            </div>`
                : ''
            }

            ${
              ghostInfo
                ? `<div style="background-color:#101a28;border:1px solid #00818d;border-radius:14px;padding:20px;margin:20px 0;text-align:left;">
              <div style="font-size:14px;font-weight:700;color:#67e8f9;margin-bottom:10px;">
                ⚡ Action Required: Create Free Account to Accept
              </div>
              <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#cbd5e1;">
                You don&apos;t have an active DebtSync account yet. This transaction agreement is securely held for <strong style="color:#ffffff;background-color:#070d17;padding:2px 8px;border-radius:6px;border:1px solid #1f2d42;font-family:monospace;">${escapeHtml(ghostInfo.email)}</strong>.
              </p>
              <div style="background-color:#070d17;border-radius:10px;padding:12px 14px;margin-bottom:14px;border:1px solid #1c283a;font-size:13px;line-height:1.6;color:#e2e8f0;">
                <strong style="color:#ffffff;">How to claim and accept this agreement:</strong>
                <ol style="margin:6px 0 0;padding-left:20px;color:#94a3b8;">
                  <li style="margin-bottom:4px;"><strong style="color:#ffffff;">Sign up</strong> with this exact email (<span style="color:#22d3ee;">${escapeHtml(ghostInfo.email)}</span>).</li>
                  <li style="margin-bottom:0;"><strong style="color:#ffffff;">Log in</strong> to view your shared ledger and tap <strong style="color:#34d399;">Accept Agreement</strong>.</li>
                </ol>
              </div>
              <div style="text-align:center;margin-top:14px;">
                <a href="${escapeHtml(ghostInfo.signupUrl)}" style="display:inline-block;background:linear-gradient(135deg,#00818d 0%,#009aa8 100%);background-color:#00818d;color:#ffffff !important;text-decoration:none;font-weight:700;font-size:13px;padding:11px 24px;border-radius:10px;box-shadow:0 4px 12px rgba(0,129,141,0.35);">
                  Sign Up with ${escapeHtml(ghostInfo.email)} &rarr;
                </a>
                <div style="margin-top:10px;font-size:12px;color:#94a3b8;">
                  Already registered? <a href="${escapeHtml(ghostInfo.loginUrl)}" style="color:#38bdf8;text-decoration:underline;font-weight:600;">Log in to accept agreement</a>
                </div>
              </div>
            </div>`
                : ghostNote
                ? `<div style="background-color:#202018;border:1px solid #6b5314;border-radius:12px;padding:14px 16px;margin:18px 0;color:#fde047;font-size:13px;line-height:1.55;">
              ${escapeHtml(ghostNote)}
            </div>`
                : ''
            }

            <!-- CTA Button -->
            <div style="text-align:center;margin:26px 0 12px;">
              <a href="${escapeHtml(effectiveCtaUrl)}" style="display:inline-block;background:linear-gradient(135deg,#00818d 0%,#009aa8 100%);background-color:#00818d;color:#ffffff !important;text-decoration:none;font-weight:700;font-size:14px;padding:13px 30px;border-radius:12px;box-shadow:0 4px 16px rgba(0,129,141,0.4);letter-spacing:0.3px;">${escapeHtml(msg.cta)} &rarr;</a>
            </div>
          </div>

          <!-- Dark Footer -->
          <div style="padding:20px 24px;font-size:11px;color:#7e8b9d;text-align:center;border-top:1px solid #1c283a;line-height:1.65;background-color:#0a101b;">
            <p style="margin:0 0 10px;color:#7e8b9d;">
              Automated transaction receipt from DebtSync. To save email limits, enable instant OS Background Push in Settings.
            </p>
            <p style="margin:0;">
              <a href="${escapeHtml(unsubUrl)}" style="color:#f87171;text-decoration:underline;font-weight:600;">Turn off email notifications</a>
              &nbsp;&bull;&nbsp;
              <a href="mailto:support@satya-nayak.dev" style="color:#38bdf8;text-decoration:none;font-weight:500;">Support</a>
            </p>
          </div>

        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function checkEmailRateLimit(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Check user's 24h sent count (limit: 5/user/day)
    const { count: userSentCount } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .gt('created_at', since);

    if (typeof userSentCount === 'number' && userSentCount >= MAX_EMAILS_PER_USER_24H) {
      return { allowed: false, reason: `user_limit_reached (${userSentCount}/${MAX_EMAILS_PER_USER_24H} in 24h)` };
    }

    // Check platform 24h global safety cap (250/day)
    const { count: globalSentCount } = await supabase
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gt('created_at', since);

    if (typeof globalSentCount === 'number' && globalSentCount >= MAX_GLOBAL_EMAILS_24H) {
      return { allowed: false, reason: `global_limit_reached (${globalSentCount}/${MAX_GLOBAL_EMAILS_24H} in 24h)` };
    }

    return { allowed: true };
  } catch (_) {
    // If table not migrated yet, allow send gracefully
    return { allowed: true };
  }
}

async function sendEmail(to: Profile, msg: Message, ghost: boolean, event: string): Promise<boolean> {
  if (!BREVO_API_KEY || !EMAIL_FROM) return false;
  if (!to.email || to.email.endsWith('@phone.debtsync.local')) return false;
  if (to.notify_email === false) return false;

  // Rate limit check: max 5 emails per user per 24 hours
  const rateLimit = await checkEmailRateLimit(to.id);
  if (!rateLimit.allowed) {
    console.warn(`[notify] Rate limit active for ${to.email}: ${rateLimit.reason}. Email skipped.`);
    await supabase.from('email_logs').insert({
      user_id: to.id,
      recipient_email: to.email,
      event,
      status: 'rate_limited',
    }).catch(() => {});
    return false;
  }

  const ghostNote = ghost
    ? `You don't have a DebtSync account yet. Sign up with ${to.email} and this record will appear in your ledger automatically.`
    : '';

  const relativeDebtUrl = msg.url.startsWith('http')
    ? new URL(msg.url).pathname + new URL(msg.url).search
    : msg.url;

  const ghostInfo = ghost && to.email ? {
    email: to.email,
    signupUrl: `${APP_URL}/signup?email=${encodeURIComponent(to.email)}&next=${encodeURIComponent(relativeDebtUrl)}`,
    loginUrl: `${APP_URL}/login?email=${encodeURIComponent(to.email)}&next=${encodeURIComponent(relativeDebtUrl)}`,
  } : null;

  const unsubUrl = await createUnsubscribeUrl(to.id);

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
      htmlContent: buildEmailHtml(displayName(to), msg, ghostNote, unsubUrl, ghostInfo),
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: ['debtsync-notification'],
    }),
  });

  if (!res.ok) {
    console.warn('[notify] Brevo error', res.status, await res.text().catch(() => ''));
    await supabase.from('email_logs').insert({
      user_id: to.id,
      recipient_email: to.email,
      event,
      status: 'failed',
    }).catch(() => {});
    return false;
  }

  // Record successful dispatch in email_logs
  await supabase.from('email_logs').insert({
    user_id: to.id,
    recipient_email: to.email,
    event,
    status: 'sent',
  }).catch(() => {});

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // 1. One-click GET/POST Unsubscribe handler (RFC 8058 compliant)
  if (url.searchParams.get('action') === 'unsubscribe') {
    const uid = url.searchParams.get('uid') || '';
    const sig = url.searchParams.get('sig') || '';
    if (!uid || !sig) {
      return new Response('Invalid request parameters.', { status: 400, headers: corsHeaders });
    }

    const expectedSig = await getUnsubscribeHmac(uid);
    if (!timingSafeEqual(sig, expectedSig)) {
      return new Response('Invalid or expired unsubscribe link.', { status: 403, headers: corsHeaders });
    }

    // Turn off notify_email in database
    await supabase.from('profiles').update({ notify_email: false }).eq('id', uid);

    // Record in email_logs
    await supabase.from('email_logs').insert({
      user_id: uid,
      recipient_email: 'unsubscribed',
      event: 'user_unsubscribed',
      status: 'unsubscribed',
    }).catch(() => {});

    if (req.method === 'POST') {
      return Response.json({ ok: true, message: 'Unsubscribed from transactional emails.' }, { headers: corsHeaders });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email Notifications Turned Off - DebtSync</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b131f; color: #dae3f4; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { max-width: 440px; background: #131c28; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 32px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
    .icon { width: 56px; height: 56px; background: rgba(0, 166, 178, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 26px; }
    h1 { font-size: 20px; margin: 0 0 8px; color: #ffffff; }
    p { font-size: 14px; line-height: 1.5; color: #8a93a0; margin: 0 0 24px; }
    .btn { display: inline-block; background: #00818d; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 24px; border-radius: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔕</div>
    <h1>Email Receipts Disabled</h1>
    <p>You have successfully turned off transactional email receipts. Your shared ledgers and balances remain active, and you can re-enable emails anytime in Settings.</p>
    <a href="${APP_URL}/settings" class="btn">Open DebtSync Settings</a>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
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

    // The counterparty of whoever acted
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

      const channel = (details.channel || 'both').toLowerCase();
      const allowEmail = channel === 'email' || channel === 'both';
      const allowPush = channel === 'push' || channel === 'both';

      if (!ghost && (event !== 'payment_reminder' || allowPush)) {
        pushTargets.push(rid);
        pushMessage = pushMessage ?? msg;
      }

      // Stop sending emails when borrower accepts a debt to conserve Brevo email quota.
      // For payment_reminder, only send if email was selected.
      if (event !== 'debt_accepted' && (event !== 'payment_reminder' || allowEmail)) {
        try {
          if (await sendEmail(recipient, msg, ghost, event)) emailsSent++;
        } catch (err) {
          console.warn('[notify] email failed', err);
        }
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
