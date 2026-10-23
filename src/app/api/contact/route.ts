import { NextRequest, NextResponse } from 'next/server';

interface ContactInquiryData {
  fullName: string;
  email: string;
  phone: string;
  category: 'support' | 'deletion' | 'rcs_sms' | 'general';
  message: string;
  optInCommunications: boolean;
}

const DEFAULT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';

// Rate limiting: max 4 inquiries per minute per IP or email
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_INQUIRIES_PER_WINDOW = 4;

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

    if (!fullName?.trim() || !email?.trim() || !phone?.trim() || !message?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Please provide all required fields (Name, Email, Phone, and Message).' },
        { status: 400 }
      );
    }

    if (!optInCommunications) {
      return NextResponse.json(
        { success: false, error: 'You must agree to communication consent before submitting.' },
        { status: 400 }
      );
    }

    const rateKey = email.toLowerCase().trim() || request.headers.get('x-forwarded-for') || 'anon';
    if (isRateLimited(rateKey)) {
      return NextResponse.json(
        { success: false, error: 'You are submitting inquiries too quickly. Please wait a minute.' },
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
    const categoryLabel = categoryLabels[category] || category;

    // Discord Webhook Dispatch
    const webhookUrl =
      process.env.DISCORD_CONTACT_WEBHOOK_URL ||
      process.env.DISCORD_BUG_WEBHOOK_URL ||
      DEFAULT_WEBHOOK_URL;

    const fields = [
      {
        name: '👤 Inquirer',
        value: `**${fullName.trim()}**\n📧 \`${email.trim()}\``,
        inline: true,
      },
      {
        name: '📱 Phone',
        value: `\`${phone.trim()}\``,
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
        value: '✅ Explicitly agreed to SMS, RCS, WhatsApp & Email communications for service updates.',
        inline: false,
      },
    ];

    const embed = {
      title: `📬 New Public Website Inquiry: ${categoryLabel}`,
      color: 0x00A896, // DebtSync Teal
      fields,
      footer: {
        text: `DebtSync Public Contact • ${new Date().toISOString()}`,
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

    // Optional Resend notification to support@satya-nayak.dev if RESEND_API_KEY is available
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'DebtSync Support <support@satya-nayak.dev>',
            to: ['support@satya-nayak.dev', 'contact@satya-nayak.dev'],
            subject: `[DebtSync Inquiry] ${categoryLabel} from ${fullName.trim()}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; padding: 20px; color: #1e293b;">
                <h2 style="color: #00818d;">New Website Inquiry Received</h2>
                <p><strong>Name:</strong> ${fullName.trim()}</p>
                <p><strong>Email:</strong> ${email.trim()}</p>
                <p><strong>Phone:</strong> ${phone.trim()}</p>
                <p><strong>Category:</strong> ${categoryLabel}</p>
                <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 15px;">
                  <p style="margin: 0; white-space: pre-wrap;">${message.trim()}</p>
                </div>
                <p style="font-size: 11px; color: #64748b; margin-top: 20px;">
                  User consented to communications via SMS, RCS, WhatsApp, and Email.
                </p>
              </div>
            `,
          }),
        });
      } catch (resendErr) {
        console.warn('[Contact Route] Resend dispatch warning:', resendErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Inquiry successfully delivered to support.',
    });
  } catch (err: any) {
    console.error('[Contact Route] Submission error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An error occurred while submitting inquiry.' },
      { status: 500 }
    );
  }
}
