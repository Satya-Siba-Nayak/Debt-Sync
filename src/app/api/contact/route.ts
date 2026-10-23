import { NextRequest, NextResponse } from 'next/server';

interface ContactInquiryData {
  fullName?: string;
  email: string;
  phone?: string;
  category: 'support' | 'deletion' | 'rcs_sms' | 'general';
  message: string;
  optInCommunications: boolean;
}

const DEFAULT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';

// Rate limiting: strict 2 inquiries per 24 hours (86,400,000 ms) per device / IP / email
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
const MAX_INQUIRIES_PER_WINDOW = 2; // max 2 per day

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

export async function POST(request: NextRequest) {
  try {
    const body: ContactInquiryData = await request.json();
    const { fullName, email, phone, category, message, optInCommunications } = body;

    // Only email and message are compulsory
    if (!email?.trim() || !email.includes('@') || !message?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Please provide a valid email address and your message.' },
        { status: 400 }
      );
    }

    if (!optInCommunications) {
      return NextResponse.json(
        { success: false, error: 'You must agree to the communication consent checkbox before submitting.' },
        { status: 400 }
      );
    }

    const deviceId = request.headers.get('x-device-id') || '';
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'anon';
    const cleanEmail = email.toLowerCase().trim();

    // Key by device ID if present, else fallback to IP + email
    const rateKey = deviceId ? `dev:${deviceId}` : `ip:${ip}:${cleanEmail}`;

    if (isRateLimited(rateKey)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Daily limit reached: Maximum 2 inquiries per 24 hours from this device. For urgent assistance, please contact support@satya-nayak.dev directly.',
        },
        { status: 429 }
      );
    }

    // Category labels
    const categoryLabels: Record<string, string> = {
      support: '🛠️ Technical & Account Support',
      deletion: '🗑️ Account & Data Deletion Request',
      rcs_sms: '📡 Telecom / Carrier / RCS Inquiry',
      general: '💬 General Feedback & Partnerships',
    };
    const categoryLabel = categoryLabels[category] || category || 'General Inquiry';

    // Discord Webhook Dispatch (ONLY Discord, no external emails)
    const webhookUrl =
      process.env.DISCORD_CONTACT_WEBHOOK_URL ||
      process.env.DISCORD_BUG_WEBHOOK_URL ||
      DEFAULT_WEBHOOK_URL;

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
        value: '✅ Consented to communications via SMS, RCS, WhatsApp & Email for service receipts & reminders.',
        inline: false,
      },
    ];

    const embed = {
      title: `📬 Public Contact Inquiry: ${categoryLabel}`,
      color: 0x00A896, // DebtSync Teal
      fields,
      footer: {
        text: `DebtSync Contact • 2/day device limit • ${new Date().toISOString()}`,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch (discordErr) {
      console.warn('[Contact Route] Discord webhook dispatch warning:', discordErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Inquiry successfully delivered to Discord.',
    });
  } catch (err: any) {
    console.error('[Contact Route] Submission error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred while submitting inquiry.' },
      { status: 500 }
    );
  }
}
