import { resolveDiscordWebhookUrl } from '../_shared/discord-webhook';

interface Env {
  DISCORD_CONTACT_WEBHOOK_URL?: string;
  DISCORD_CONTACT_WEBHOOK_URI?: string;
  DISCORD_BUG_WEBHOOK_URL?: string;
  DISCORD_BUG_WEBHOOK_URI?: string;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URI?: string;
}

// Rate limit memory for Cloudflare Worker instance: 2 per 24 hours across IP, Device ID, and Email
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000;
const MAX_INQUIRIES_PER_WINDOW = 2;

function sanitizeDiscordText(input: string, maxLen = 1800): string {
  const cleaned = input
    .replace(/@everyone/gi, '@\u200beveryone')
    .replace(/@here/gi, '@\u200bhere')
    .replace(/<@&\d+>/g, '@role')
    .trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}...` : cleaned;
}

function isMultiKeyRateLimited(keys: string[]): boolean {
  const now = Date.now();
  const validKeys = Array.from(new Set(keys.filter(Boolean)));

  // 1. Check if ANY of the keys (IP, Device ID, Email, Cookie) has reached the 2/24h limit
  for (const key of validKeys) {
    const timestamps = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW);
    if (timestamps.length >= MAX_INQUIRIES_PER_WINDOW) {
      rateLimitMap.set(key, timestamps);
      return true;
    }
  }

  // 2. Record the attempt against all keys
  for (const key of validKeys) {
    const timestamps = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW);
    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
  }

  return false;
}

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    // Same-origin / Referer verification against external cross-site spam bots
    const origin = context.request.headers.get('origin') || '';
    const referer = context.request.headers.get('referer') || '';
    if (origin && !origin.includes('satya-nayak.dev') && !origin.includes('pages.dev') && !origin.includes('localhost')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden origin.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!origin && referer && !referer.includes('satya-nayak.dev') && !referer.includes('pages.dev') && !referer.includes('localhost')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden referer.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body: Record<string, unknown> = await context.request.json().catch(() => ({}));
    const fullName = body.fullName as string | undefined;
    const email = body.email as string | undefined;
    const phone = body.phone as string | undefined;
    const category = body.category as string | undefined;
    const message = body.message as string | undefined;
    const optInCommunications = body.optInCommunications as boolean | undefined;

    if (!email?.trim() || !email.includes('@') || email.length > 254 || !message?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid email address and your message.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!optInCommunications) {
      return new Response(
        JSON.stringify({ success: false, error: 'You must agree to the communication consent checkbox.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const deviceId = (context.request.headers.get('x-device-id') || '').slice(0, 128);
    const ip =
      context.request.headers.get('cf-connecting-ip') ||
      context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'anon';
    const cleanEmail = email.toLowerCase().trim();

    // Parse HttpOnly quota cookie if present
    const cookieHeader = context.request.headers.get('cookie') || '';
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)ds_contact_q=(\d+):(\d+)/);
    const now = Date.now();
    let cookieCount = 0;
    let cookieWindowStart = now;
    if (cookieMatch) {
      const parsedCount = Number(cookieMatch[1]);
      const parsedStart = Number(cookieMatch[2]);
      if (Number.isFinite(parsedCount) && Number.isFinite(parsedStart) && now - parsedStart < RATE_LIMIT_WINDOW) {
        cookieCount = parsedCount;
        cookieWindowStart = parsedStart;
      }
    }

    const webhookUrl = resolveDiscordWebhookUrl(context.env as Record<string, string | undefined>, 'contact');
    if (!webhookUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Support channel is temporarily unavailable. Please email support@satya-nayak.dev directly.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const rateKeys = [
      ip !== 'anon' ? `ip:${ip}` : '',
      deviceId ? `dev:${deviceId}` : '',
      `email:${cleanEmail}`,
    ];

    if (cookieCount >= MAX_INQUIRIES_PER_WINDOW || isMultiKeyRateLimited(rateKeys)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Daily limit reached: Maximum 2 inquiries per 24 hours from this device. For urgent assistance, please contact support@satya-nayak.dev directly.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const categoryLabels: Record<string, string> = {
      support: '🛠️ Technical & Account Support',
      deletion: '🗑️ Account & Data Deletion Request',
      rcs_sms: '📡 Telecom / Carrier / RCS Inquiry',
      general: '💬 General Feedback & Partnerships',
    };
    const categoryLabel = categoryLabels[category || ''] || sanitizeDiscordText(String(category || 'General Inquiry'), 80);

    const safeName = sanitizeDiscordText(fullName?.trim() || 'Website Visitor', 120);
    const safeEmail = sanitizeDiscordText(cleanEmail, 160);
    const safePhone = phone?.trim() ? `\`${sanitizeDiscordText(phone.trim(), 40)}\`` : '_Not Provided (Email Only)_';
    const safeMessage = sanitizeDiscordText(message.trim(), 1800);

    const fields = [
      {
        name: '👤 Inquirer',
        value: `**${safeName}**\n📧 \`${safeEmail}\``,
        inline: true,
      },
      {
        name: '📱 Phone',
        value: safePhone,
        inline: true,
      },
      {
        name: '🏷️ Category',
        value: categoryLabel,
        inline: false,
      },
      {
        name: '💬 Inquiry Message',
        value: safeMessage,
        inline: false,
      },
      {
        name: '📜 Telecom / Operator Consent',
        value: '✅ Consented to communications via SMS, RCS, WhatsApp & Email for service updates & receipts.',
        inline: false,
      },
    ];

    const embed = {
      title: `📬 Public Contact Inquiry: ${categoryLabel}`,
      color: 0x00a896,
      fields,
      footer: {
        text: `DebtSync Contact • 2/day device limit • ${new Date().toISOString()}`,
      },
      timestamp: new Date().toISOString(),
    };

    const discordRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [embed],
        allowed_mentions: { parse: [] },
      }),
    });

    if (!discordRes.ok && discordRes.status !== 204) {
      console.warn('[Cloudflare Contact Route] Discord webhook failed:', discordRes.status);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Could not deliver your inquiry. Please email support@satya-nayak.dev directly.',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const nextCookieVal = `${cookieCount + 1}:${cookieWindowStart}`;
    return new Response(
      JSON.stringify({ success: true, message: 'Inquiry successfully delivered to Discord.' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `ds_contact_q=${nextCookieVal}; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax; Secure`,
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An error occurred while submitting inquiry.';
    console.error('[Cloudflare Contact Route] Submission error:', err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
