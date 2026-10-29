import { NextRequest, NextResponse } from 'next/server';
import { resolveDiscordWebhookFromProcess } from '@/lib/server/discord-webhook';

interface ContactInquiryData {
  fullName?: string;
  email: string;
  phone?: string;
  category: 'support' | 'deletion' | 'rcs_sms' | 'general';
  message: string;
  optInCommunications: boolean;
}

// Rate limiting: strict 2 inquiries per 24 hours (86,400,000 ms) per device, IP, AND email
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
const MAX_INQUIRIES_PER_WINDOW = 2; // max 2 per day

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

  for (const key of validKeys) {
    const timestamps = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW);
    if (timestamps.length >= MAX_INQUIRIES_PER_WINDOW) {
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

export async function POST(request: NextRequest) {
  try {
    const body: ContactInquiryData = await request.json();
    const { fullName, email, phone, category, message, optInCommunications } = body;

    // Only email and message are compulsory
    if (!email?.trim() || !email.includes('@') || email.length > 254 || !message?.trim()) {
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

    const deviceId = (request.headers.get('x-device-id') || '').slice(0, 128);
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'anon';
    const cleanEmail = email.toLowerCase().trim();

    const rateKeys = [
      ip !== 'anon' ? `ip:${ip}` : '',
      deviceId ? `dev:${deviceId}` : '',
      `email:${cleanEmail}`,
    ];

    if (isMultiKeyRateLimited(rateKeys)) {
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
    const categoryLabel = categoryLabels[category] || sanitizeDiscordText(String(category || 'General Inquiry'), 80);

    const webhookUrl = resolveDiscordWebhookFromProcess('contact');
    if (!webhookUrl) {
      console.error('[Contact Route] Discord webhook is not configured (set DISCORD_WEBHOOK_URL on the server).');
      return NextResponse.json(
        {
          success: false,
          error: 'Support channel is temporarily unavailable. Please email support@satya-nayak.dev directly.',
        },
        { status: 503 }
      );
    }

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
        body: JSON.stringify({
          embeds: [embed],
          allowed_mentions: { parse: [] },
        }),
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
