import { resolveDiscordWebhookUrl } from '../_shared/discord-webhook';

interface Env {
  DISCORD_BUG_WEBHOOK_URL?: string;
  DISCORD_BUG_WEBHOOK_URI?: string;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URI?: string;
  DISCORD_CONTACT_WEBHOOK_URL?: string;
  DISCORD_CONTACT_WEBHOOK_URI?: string;
}

// Rate limiting for Cloudflare Worker instance: max 5 reports per hour per IP / identifier
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_REPORTS_PER_WINDOW = 5;
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB

function sanitizeDiscordText(input: string, maxLen = 1500): string {
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

  for (const key of validKeys) {
    const timestamps = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW);
    if (timestamps.length >= MAX_REPORTS_PER_WINDOW) {
      rateLimitMap.set(key, timestamps);
      return true;
    }
  }

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

    const contentType = context.request.headers.get('content-type') || '';
    let reportData: Record<string, unknown>;
    const uploadedFiles: File[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await context.request.formData();
      const payloadRaw = formData.get('payload_json');

      if (payloadRaw && typeof payloadRaw === 'string') {
        reportData = JSON.parse(payloadRaw);
      } else {
        const category = formData.get('category') || 'bug';
        const description = formData.get('description') || '';
        const errorMessage = formData.get('errorMessage') || null;
        const route = formData.get('route') || '';
        const userName = formData.get('userName') || '';
        const userEmail = formData.get('userEmail') || '';
        const userId = formData.get('userId') || '';
        let device: Record<string, unknown> | undefined;
        try {
          const deviceRaw = formData.get('device');
          if (deviceRaw && typeof deviceRaw === 'string') device = JSON.parse(deviceRaw);
        } catch {
          /* ignore malformed device payload */
        }

        reportData = { category, description, errorMessage, route, device, userName, userEmail, userId };
      }

      for (const [key, value] of formData.entries()) {
        if (value instanceof File && key.startsWith('files')) {
          uploadedFiles.push(value);
        }
      }
    } else {
      reportData = await context.request.json();
    }

    if (uploadedFiles.length > MAX_FILES) {
      return new Response(
        JSON.stringify({ success: false, error: `Maximum ${MAX_FILES} attachments allowed per report.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const totalSize = uploadedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    if (totalSize > MAX_TOTAL_BYTES) {
      return new Response(
        JSON.stringify({ success: false, error: 'Total attachment size exceeds 25 MB limit.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const category = String(reportData.category || 'bug');
    const description = String(reportData.description || '');
    const errorMessage = reportData.errorMessage as string | null | undefined;
    const route = String(reportData.route || '');
    const device = reportData.device as Record<string, unknown> | undefined;
    const userName = String(reportData.userName || '');
    const userEmail = String(reportData.userEmail || '');
    const userId = String(reportData.userId || '');

    if (!description?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a brief description of what happened.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const webhookUrl = resolveDiscordWebhookUrl(context.env as Record<string, string | undefined>, 'bug');
    if (!webhookUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Bug reporting is temporarily unavailable. Please email support@satya-nayak.dev with a screenshot.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ip =
      context.request.headers.get('cf-connecting-ip') ||
      context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'anon';
    const rateKeys = [
      ip !== 'anon' ? `ip:${ip}` : '',
      userId ? `uid:${userId.slice(0, 64)}` : '',
      userEmail ? `email:${userEmail.toLowerCase().trim().slice(0, 120)}` : '',
    ];

    if (isMultiKeyRateLimited(rateKeys)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'You have reached the hourly report limit. Please wait a while before sending more reports.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let color = 0xed4245;
    let title = '🐛 Bug Report';
    if (category === 'ui') {
      color = 0xe67e22;
      title = '🎨 UI / Visual Glitch';
    } else if (category === 'idea') {
      color = 0x1abc9c;
      title = '💡 Feature Idea & Feedback';
    }

    const safeUserName = sanitizeDiscordText(userName, 100);
    const safeUserEmail = sanitizeDiscordText(userEmail, 120);
    const safeRoute = sanitizeDiscordText(route, 200);

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      {
        name: '👤 Reporter',
        value: safeUserName
          ? `**${safeUserName}**\n${safeUserEmail || 'No email'}`
          : safeUserEmail
          ? `**${safeUserEmail}**`
          : 'Anonymous User',
        inline: true,
      },
      {
        name: '📍 Page Route',
        value: safeRoute ? `\`${safeRoute}\`` : '`Unknown`',
        inline: true,
      },
    ];

    if (device) {
      const typeLabel = device.isTablet ? '📱 Tablet' : device.isMobile ? '📱 Mobile' : '💻 Desktop';
      const specs = [
        `${typeLabel} • ${device.os || 'Unknown OS'} • ${device.browser || 'Unknown Browser'}`,
        `Screen: ${device.screenResolution || 'N/A'} | Viewport: ${device.viewportSize || 'N/A'} (${device.pixelRatio || '1x'})`,
        `Network: ${device.network || 'Online'} | Theme: ${device.theme || 'Dark'}`,
        device.timezone ? `Timezone: ${device.timezone} • ${device.localTime || ''}` : '',
        [device.cores, device.memory].filter(Boolean).join(' • '),
        device.isPWA ? '⚡ Installed PWA Mode' : '',
      ]
        .filter(Boolean)
        .join('\n');

      fields.push({
        name: '🖥️ System & Environment Diagnostics',
        value: sanitizeDiscordText(specs, 1000),
        inline: false,
      });
    }

    if (errorMessage?.trim()) {
      const truncated = sanitizeDiscordText(errorMessage, 950);
      fields.push({
        name: '⚠️ In-Error Banner Message',
        value: `\`\`\`${truncated}\`\`\``,
        inline: false,
      });
    }

    if (Array.isArray(device?.recentErrors) && device.recentErrors.length > 0) {
      const errorDump = sanitizeDiscordText((device.recentErrors as string[]).join('\n'), 950);
      fields.push({
        name: '📜 Recent Runtime JavaScript Errors',
        value: `\`\`\`${errorDump}\`\`\``,
        inline: false,
      });
    }

    if (uploadedFiles.length > 0) {
      const fileSummary = uploadedFiles
        .map((f, i) => `#${i + 1} **${sanitizeDiscordText(f.name, 80)}** (${(f.size / (1024 * 1024)).toFixed(2)} MB • ${f.type || 'file'})`)
        .join('\n');
      fields.push({
        name: `📎 Attached Media (${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''})`,
        value: fileSummary.slice(0, 1000),
        inline: false,
      });
    }

    let embeddedImageAttachment: string | undefined;
    const firstImageFile = uploadedFiles.find((f) => f.type.startsWith('image/'));
    if (firstImageFile) {
      embeddedImageAttachment = firstImageFile.name;
    }

    const embed: Record<string, unknown> = {
      title,
      color,
      description: `### User Note\n${sanitizeDiscordText(description, 1800)}`,
      fields,
      footer: {
        text: 'DebtSync Cloudflare Edge • Live Telemetry',
      },
      timestamp: new Date().toISOString(),
    };

    if (embeddedImageAttachment) {
      embed.image = { url: `attachment://${embeddedImageAttachment}` };
    }

    const discordPayload = {
      username: 'DebtSync Telemetry',
      avatar_url: 'https://raw.githubusercontent.com/Satya-Siba-Nayak/Debt-Sync/main/public/icon.svg',
      embeds: [embed],
      allowed_mentions: { parse: [] },
    };

    let discordRes: Response;

    if (uploadedFiles.length > 0) {
      const discordFormData = new FormData();
      discordFormData.append('payload_json', JSON.stringify(discordPayload));

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        discordFormData.append(`files[${i}]`, file, file.name);
      }

      discordRes = await fetch(webhookUrl, {
        method: 'POST',
        body: discordFormData,
      });
    } else {
      discordRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload),
      });
    }

    if (!discordRes.ok && discordRes.status !== 204) {
      return new Response(
        JSON.stringify({ success: false, error: `Discord rejected webhook: ${discordRes.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: true, message: 'Delivered to Discord.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
