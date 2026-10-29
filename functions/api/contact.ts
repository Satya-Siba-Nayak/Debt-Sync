import { resolveDiscordWebhookUrl } from '../_shared/discord-webhook';

interface Env {
  DISCORD_CONTACT_WEBHOOK_URL?: string;
  DISCORD_CONTACT_WEBHOOK_URI?: string;
  DISCORD_BUG_WEBHOOK_URL?: string;
  DISCORD_BUG_WEBHOOK_URI?: string;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URI?: string;
}

// Rate limit memory for Cloudflare Worker instance: 2 per 24 hours
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000;
const MAX_INQUIRIES_PER_WINDOW = 2;

function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(identifier) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);

  if (validTimestamps.length >= MAX_INQUIRIES_PER_WINDOW) {
    return true;
  }

  validTimestamps.push(now);
  rateLimitMap.set(identifier, validTimestamps);
  return false;
}

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const body: Record<string, unknown> = await context.request.json().catch(() => ({}));
    const fullName = body.fullName as string | undefined;
    const email = body.email as string | undefined;
    const phone = body.phone as string | undefined;
    const category = body.category as string | undefined;
    const message = body.message as string | undefined;
    const optInCommunications = body.optInCommunications as boolean | undefined;

    if (!email?.trim() || !email.includes('@') || !message?.trim()) {
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

    const deviceId = context.request.headers.get('x-device-id') || '';
    const ip = context.request.headers.get('cf-connecting-ip') || context.request.headers.get('x-forwarded-for') || 'anon';
    const cleanEmail = email.toLowerCase().trim();
    const rateKey = deviceId ? `dev:${deviceId}` : `ip:${ip}:${cleanEmail}`;

    if (isRateLimited(rateKey)) {
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
    const categoryLabel = categoryLabels[category || ''] || category || 'General Inquiry';

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

    const fields = [
      {
        name: '👤 Inquirer',
        value: `**${fullName?.trim() || 'Website Visitor'}**\n📧 \`${cleanEmail}\``,
        inline: true,
      },
      {
        name: '📱 Phone',
        value: phone?.trim() ? `\`${phone.trim()}\`` : '_Not Provided (Email Only)_',
        inline: true,
      },
      {
        name: '🏷️ Category',
        value: categoryLabel,
        inline: false,
      },
      {
        name: '💬 Inquiry Message',
        value: message.trim().length > 1800 ? message.trim().slice(0, 1800) + '...' : message.trim(),
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
      body: JSON.stringify({ embeds: [embed] }),
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

    return new Response(
      JSON.stringify({ success: true, message: 'Inquiry successfully delivered to Discord.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
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
