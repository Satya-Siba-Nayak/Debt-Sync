import { NextRequest, NextResponse } from 'next/server';

interface EmailPayload {
  type: 'ghost_account_invite' | 'payment_request' | 'debt_recorded';
  recipientEmail: string;
  recipientName?: string;
  senderName: string;
  amount: number;
  currency: string;
  notes?: string;
  debtId?: string;
}

// In-memory rate limiting map: recipientEmail:type -> timestamp
const rateLimitMap = new Map<string, number>();

// Clean up entries older than 2 hours periodically
const CLEANUP_INTERVAL = 2 * 60 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupRateLimits() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, timestamp] of rateLimitMap.entries()) {
    if (now - timestamp > CLEANUP_INTERVAL) {
      rateLimitMap.delete(key);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    cleanupRateLimits();

    const body: EmailPayload = await request.json();
    const { type, recipientEmail, recipientName, senderName, amount, currency, notes } = body;

    if (!recipientEmail || !type || !senderName) {
      return NextResponse.json(
        { success: false, error: 'Missing required email notification fields.' },
        { status: 400 }
      );
    }

    const cleanEmail = recipientEmail.trim().toLowerCase();
    // Do not attempt to send email to internal local fallback addresses
    if (cleanEmail.endsWith('@phone.debtsync.local')) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Internal phone-only identifier; email skipped.',
      });
    }

    // Determine Cooldown
    const cooldownMs =
      type === 'ghost_account_invite'
        ? 60 * 60 * 1000 // 1 hour for ghost account creation
        : 15 * 60 * 1000; // 15 minutes for payment/debt updates

    const rateKey = `${cleanEmail}:${type}`;
    const lastSent = rateLimitMap.get(rateKey);
    const now = Date.now();

    if (lastSent && now - lastSent < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - (now - lastSent)) / 60000);
      return NextResponse.json(
        {
          success: false,
          rateLimited: true,
          error: `Rate limit active: An email was already sent to this recipient recently. Please wait ${remainingMinutes} minute(s).`,
        },
        { status: 429 }
      );
    }

    // Build subject and HTML template
    const formattedAmount = `${currency.toUpperCase()} ${Number(amount).toLocaleString()}`;
    let subject = '';
    let headline = '';
    let description = '';
    let ctaText = 'Open DebtSync Ledger';

    if (type === 'ghost_account_invite') {
      subject = `${senderName} logged a transaction of ${formattedAmount} with you on DebtSync`;
      headline = 'New Peer Ledger Agreement Recorded';
      description = `<strong>${senderName}</strong> recorded a transaction of <strong>${formattedAmount}</strong> with you. A ledger profile has been reserved for you to review, track live interest, and verify payments.`;
      ctaText = 'Claim Profile & Review Ledger';
    } else if (type === 'payment_request') {
      subject = `Repayment of ${formattedAmount} reported by ${senderName}`;
      headline = 'Payment Verification Request';
      description = `<strong>${senderName}</strong> has reported a repayment of <strong>${formattedAmount}</strong> on your shared ledger. Please review and verify the receipt.`;
      ctaText = 'Verify Repayment Receipt';
    } else {
      subject = `Ledger update of ${formattedAmount} from ${senderName}`;
      headline = 'Ledger Agreement Update';
      description = `<strong>${senderName}</strong> updated a shared transaction agreement for <strong>${formattedAmount}</strong>.`;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://debtsync.com';

    const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9ff; margin: 0; padding: 30px 10px; color: #131c28; }
            .container { max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #dae3f4; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
            .header { background: linear-gradient(135deg, #004349 0%, #0d5c63 100%); padding: 24px; text-align: center; color: #ffffff; }
            .content { padding: 28px; }
            .card { background-color: #eff4ff; border-radius: 12px; padding: 18px; margin: 20px 0; border: 1px solid #bfc8c9; }
            .btn { display: inline-block; background-color: #004349; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 24px; border-radius: 10px; margin-top: 15px; }
            .footer { padding: 16px 28px; font-size: 11px; color: #6f797a; text-align: center; border-top: 1px solid #eff4ff; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin:0; font-size: 20px; letter-spacing: 0.5px;">DebtSync</h2>
              <p style="margin:4px 0 0; font-size: 11px; opacity: 0.85; text-transform: uppercase; letter-spacing: 1px;">Trust & Precision Peer Ledgers</p>
            </div>
            <div class="content">
              <h3 style="margin-top:0; color: #004349;">${headline}</h3>
              <p style="font-size: 14px; line-height: 1.6;">Hello ${recipientName || 'there'},</p>
              <p style="font-size: 14px; line-height: 1.6;">${description}</p>
              
              <div class="card">
                <div style="font-size: 11px; text-transform: uppercase; color: #6f797a; font-weight: bold; margin-bottom: 4px;">Transaction Amount</div>
                <div style="font-size: 24px; font-weight: bold; color: #004349;">${formattedAmount}</div>
                ${notes ? `<div style="margin-top: 8px; font-size: 12px; color: #3f484a; font-style: italic;">"${notes}"</div>` : ''}
              </div>

              <div style="text-align: center;">
                <a href="${appUrl}" class="btn" style="color:#ffffff;">${ctaText}</a>
              </div>
            </div>
            <div class="footer">
              This automated notification was generated by DebtSync upon transaction activity. If this message landed in your Spam/Junk folder, please select &quot;Report Not Spam&quot; and add DebtSync to your trusted contacts to ensure uninterrupted ledger receipts.
            </div>
          </div>
        </body>
      </html>
    `;

    // Dispatch via Resend if API key is provided
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'DebtSync <notifications@debtsync.com>',
            to: [cleanEmail],
            subject,
            html: htmlBody,
          }),
        });

        if (!resendRes.ok) {
          const errData = await resendRes.json();
          console.warn('[DebtSync Email] Resend API error:', errData);
        } else {
          rateLimitMap.set(rateKey, now);
          return NextResponse.json({ success: true, delivered: true });
        }
      } catch (sendErr) {
        console.warn('[DebtSync Email] Delivery attempt error:', sendErr);
      }
    }

    // Simulated / fallback dispatch (logging for audit & seamless non-blocking operation)
    rateLimitMap.set(rateKey, now);
    console.log(`[DebtSync Email Notification (Simulated)]: Type=${type}, To=${cleanEmail}, Sender=${senderName}, Amount=${formattedAmount}`);

    return NextResponse.json({
      success: true,
      delivered: false,
      simulated: true,
      message: 'Email notification logged (configure RESEND_API_KEY for external delivery)',
    });
  } catch (err: any) {
    console.error('Failed to process email notification:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
