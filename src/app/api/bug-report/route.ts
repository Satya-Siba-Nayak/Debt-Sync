import { NextRequest, NextResponse } from 'next/server';

interface BugReportPayload {
  category: 'bug' | 'ui' | 'idea';
  description: string;
  errorMessage?: string | null;
  route?: string;
  device?: {
    os?: string;
    browser?: string;
    isMobile?: boolean;
    screenResolution?: string;
    userAgent?: string;
  };
  userName?: string;
  userEmail?: string;
}

// In-memory rate limiting map: userEmail/ip -> timestamp array
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REPORTS_PER_WINDOW = 5;

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

export async function POST(request: NextRequest) {
  try {
    const body: BugReportPayload = await request.json();
    const { category, description, errorMessage, route, device, userName, userEmail } = body;

    if (!description?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Please provide a brief description of what happened.' },
        { status: 400 }
      );
    }

    const rateKey = userEmail || request.headers.get('x-forwarded-for') || 'anon';
    if (isRateLimited(rateKey)) {
      return NextResponse.json(
        { success: false, error: 'You are submitting reports too quickly. Please wait a moment.' },
        { status: 429 }
      );
    }

    const webhookUrl =
      process.env.DISCORD_BUG_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL;

    if (!webhookUrl) {
      console.warn('DISCORD_BUG_WEBHOOK_URL not configured. Bug report logged to server console:', {
        category,
        description,
        errorMessage,
        route,
        userEmail,
      });
      return NextResponse.json({
        success: true,
        loggedOnly: true,
        message: 'Report received! (Discord webhook URL not yet configured in .env.local)',
      });
    }

    // Color codes: Red for Bug (0xED4245), Amber for UI (0xE67E22), Cyan for Idea (0x1ABC9C)
    let color = 0xED4245;
    let title = '🐛 New Bug Report';
    if (category === 'ui') {
      color = 0xE67E22;
      title = '🎨 UI / Visual Glitch Report';
    } else if (category === 'idea') {
      color = 0x1ABC9C;
      title = '💡 Feature Idea / Suggestion';
    }

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      {
        name: '👤 Reporter',
        value: userName ? `${userName} (${userEmail || 'No email'})` : userEmail || 'Anonymous User',
        inline: true,
      },
      {
        name: '📍 Page Route',
        value: route ? `\`${route}\`` : '`Unknown`',
        inline: true,
      },
    ];

    if (device) {
      fields.push({
        name: '📱 Device & Browser',
        value: `${device.isMobile ? 'Mobile' : 'Desktop'} • ${device.os || 'Unknown OS'} • ${device.browser || 'Unknown Browser'}\n\`${device.screenResolution || 'N/A'}\``,
        inline: false,
      });
    }

    if (errorMessage?.trim()) {
      const truncatedError = errorMessage.length > 950 ? errorMessage.slice(0, 950) + '...' : errorMessage;
      fields.push({
        name: '⚠️ Captured Error',
        value: `\`\`\`\n${truncatedError}\n\`\`\``,
        inline: false,
      });
    }

    const discordPayload = {
      username: 'DebtSync Bug Bot',
      avatar_url: 'https://raw.githubusercontent.com/Satya-Siba-Nayak/Debt-Sync/main/public/icon.svg',
      embeds: [
        {
          title,
          color,
          description: description.trim(),
          fields,
          footer: {
            text: 'DebtSync User Feedback • Live Telemetry',
          },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const discordRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(discordPayload),
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text();
      console.error('Failed to dispatch Discord webhook:', discordRes.status, errText);
      return NextResponse.json(
        { success: false, error: 'Could not deliver report to Discord. Please check webhook configuration.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, message: 'Bug report sent to Discord successfully.' });
  } catch (err: any) {
    console.error('Bug report API error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error while reporting bug.' },
      { status: 500 }
    );
  }
}
