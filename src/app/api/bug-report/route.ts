import { NextRequest, NextResponse } from 'next/server';

interface DeviceData {
  os?: string;
  browser?: string;
  isMobile?: boolean;
  isTablet?: boolean;
  screenResolution?: string;
  viewportSize?: string;
  pixelRatio?: string;
  orientation?: string;
  touchSupport?: boolean;
  language?: string;
  timezone?: string;
  localTime?: string;
  network?: string;
  isPWA?: boolean;
  theme?: string;
  memory?: string;
  cores?: string;
  userAgent?: string;
  recentErrors?: string[];
}

interface BugReportData {
  category: 'bug' | 'ui' | 'idea';
  description: string;
  errorMessage?: string | null;
  route?: string;
  device?: DeviceData;
  userName?: string;
  userEmail?: string;
  userId?: string;
}

// In-memory rate limiting map: identifier -> timestamp array
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REPORTS_PER_WINDOW = 6;

function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(identifier) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);

  if (validTimestamps.length >= MAX_REPORTS_PER_WINDOW) {
    return true;
  }

  validTimestamps.push(now);
  rateLimitMap.set(identifier, validTimestamps);
  return false;
}

const DEFAULT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let reportData: BugReportData;
    const uploadedFiles: File[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const payloadRaw = formData.get('payload_json');

      if (payloadRaw && typeof payloadRaw === 'string') {
        reportData = JSON.parse(payloadRaw);
      } else {
        const category = (formData.get('category') as any) || 'bug';
        const description = (formData.get('description') as string) || '';
        const errorMessage = (formData.get('errorMessage') as string) || null;
        const route = (formData.get('route') as string) || '';
        const userName = (formData.get('userName') as string) || '';
        const userEmail = (formData.get('userEmail') as string) || '';
        const userId = (formData.get('userId') as string) || '';
        let device: DeviceData | undefined;
        try {
          const deviceRaw = formData.get('device');
          if (deviceRaw && typeof deviceRaw === 'string') device = JSON.parse(deviceRaw);
        } catch (_) {}

        reportData = { category, description, errorMessage, route, device, userName, userEmail, userId };
      }

      // Collect all attached files
      for (const [key, value] of formData.entries()) {
        if (value instanceof File && key.startsWith('files')) {
          uploadedFiles.push(value);
        }
      }
    } else {
      reportData = await request.json();
    }

    const { category, description, errorMessage, route, device, userName, userEmail, userId } = reportData;

    if (!description?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Please provide a brief description of what happened.' },
        { status: 400 }
      );
    }

    const rateKey = userEmail || userId || request.headers.get('x-forwarded-for') || 'anon';
    if (isRateLimited(rateKey)) {
      return NextResponse.json(
        { success: false, error: 'You are submitting reports too quickly. Please wait a moment.' },
        { status: 429 }
      );
    }

    const webhookUrl =
      process.env.DISCORD_BUG_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL ||
      DEFAULT_WEBHOOK_URL;

    // Discord Embed Category Styling
    let color = 0xED4245; // Red
    let title = '🐛 Bug Report';
    if (category === 'ui') {
      color = 0xE67E22; // Amber/Orange
      title = '🎨 UI / Visual Glitch';
    } else if (category === 'idea') {
      color = 0x1ABC9C; // Teal/Cyan
      title = '💡 Feature Idea & Feedback';
    }

    // Build rich fields
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      {
        name: '👤 Reporter',
        value: userName ? `**${userName}**\n${userEmail || 'No email'}` : userEmail ? `**${userEmail}**` : 'Anonymous User',
        inline: true,
      },
      {
        name: '📍 Page Route',
        value: route ? `\`${route}\`` : '`Unknown`',
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
        value: specs.length > 1000 ? specs.slice(0, 1000) + '...' : specs,
        inline: false,
      });
    }

    if (errorMessage?.trim()) {
      const truncated = errorMessage.length > 950 ? errorMessage.slice(0, 950) + '...' : errorMessage;
      fields.push({
        name: '⚠️ In-Error Banner Message',
        value: `\`\`\`${truncated}\`\`\``,
        inline: false,
      });
    }

    if (device?.recentErrors && device.recentErrors.length > 0) {
      const errorDump = device.recentErrors.join('\n').slice(0, 950);
      fields.push({
        name: '📜 Recent Runtime JavaScript Errors',
        value: `\`\`\`${errorDump}\`\`\``,
        inline: false,
      });
    }

    if (uploadedFiles.length > 0) {
      const fileSummary = uploadedFiles
        .map((f, i) => `#${i + 1} **${f.name}** (${(f.size / (1024 * 1024)).toFixed(2)} MB • ${f.type || 'file'})`)
        .join('\n');
      fields.push({
        name: `📎 Attached Media (${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''})`,
        value: fileSummary.slice(0, 1000),
        inline: false,
      });
    }

    // Determine primary embedded image if any attachment is an image
    let embeddedImageAttachment: string | undefined;
    const firstImageFile = uploadedFiles.find((f) => f.type.startsWith('image/'));
    if (firstImageFile) {
      embeddedImageAttachment = firstImageFile.name;
    }

    const embed: any = {
      title,
      color,
      description: `### User Note\n${description.trim()}`,
      fields,
      footer: {
        text: 'DebtSync Live Telemetry & User Feedback',
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(discordPayload),
      });
    }

    if (!discordRes.ok && discordRes.status !== 204) {
      const errText = await discordRes.text();
      console.error('Discord webhook dispatch failed:', discordRes.status, errText);
      return NextResponse.json(
        { success: false, error: `Discord rejected webhook (${discordRes.status}).` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Bug report sent to Discord successfully with attachments.',
    });
  } catch (err: any) {
    console.error('Bug report API error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error while reporting bug.' },
      { status: 500 }
    );
  }
}
