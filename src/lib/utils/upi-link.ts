/**
 * UPI Payment Link & QR Code Generation Utilities
 *
 * Generates UPI deeplinks (upi://pay?...) and QR code data URLs
 * for seamless mobile payments between DebtSync users.
 */

/**
 * Validate a UPI VPA (Virtual Payment Address) format.
 * Valid formats: user@bank, user.name@bank, user-name@bank
 */
export function isValidUPIId(upiId: string): boolean {
  if (!upiId || typeof upiId !== 'string') return false;
  const vpaRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z][a-zA-Z0-9]*$/;
  return vpaRegex.test(upiId.trim());
}

/**
 * Generate a UPI deeplink URL.
 *
 * @param upiId - Payee's UPI VPA (e.g. "satya@upi")
 * @param payeeName - Payee's display name
 * @param amount - Payment amount (optional, can be left for user to fill)
 * @param currency - Currency code (default: INR)
 * @param transactionNote - Payment note/reference
 * @returns UPI deeplink string (e.g. "upi://pay?pa=satya@upi&pn=Satya&am=500.00&cu=INR&tn=DebtSync Payment")
 */
export function generateUPILink(
  upiId: string,
  payeeName: string,
  amount?: number,
  currency: string = 'INR',
  transactionNote?: string
): string {
  const params = new URLSearchParams();
  params.set('pa', upiId.trim());
  params.set('pn', payeeName.trim());
  if (amount && amount > 0) {
    params.set('am', amount.toFixed(2));
  }
  params.set('cu', currency.toUpperCase());
  if (transactionNote) {
    params.set('tn', transactionNote.trim().substring(0, 50));
  }
  // Set merchant code for person-to-person transfers
  params.set('mc', '0000');
  params.set('mode', '02'); // UPI Collect mode

  return `upi://pay?${params.toString()}`;
}

import QRCode from 'qrcode';

/**
 * Generate a QR code as a data URL (PNG) for the given UPI link.
 */
export async function generateUPIQRCodeDataURL(upiLink: string, size: number = 240): Promise<string> {
  try {
    return await QRCode.toDataURL(upiLink, {
      width: size,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
    return '';
  }
}

/**
 * Get the appropriate icon name for a UPI app.
 */
export function getUPIAppIcon(appName: string): string {
  switch (appName.toLowerCase()) {
    case 'gpay':
    case 'google_pay':
      return 'google';
    case 'phonepe':
      return 'smartphone';
    case 'paytm':
      return 'account_balance_wallet';
    default:
      return 'qr_code_2';
  }
}

/**
 * Payment method labels for display.
 */
export const PAYMENT_METHOD_LABELS: Record<string, { label: string; icon: string; placeholder: string }> = {
  cash: {
    label: 'Cash',
    icon: 'payments',
    placeholder: '',
  },
  upi: {
    label: 'UPI',
    icon: 'qr_code_2',
    placeholder: 'UPI Transaction ID (e.g. 412345678901)',
  },
  bank_transfer: {
    label: 'Bank Transfer',
    icon: 'account_balance',
    placeholder: 'NEFT/IMPS/RTGS Reference Number',
  },
  gpay: {
    label: 'Google Pay',
    icon: 'smartphone',
    placeholder: 'GPay Transaction ID',
  },
  phonepe: {
    label: 'PhonePe',
    icon: 'smartphone',
    placeholder: 'PhonePe Transaction ID',
  },
  paytm: {
    label: 'Paytm',
    icon: 'account_balance_wallet',
    placeholder: 'Paytm Order/Transaction ID',
  },
  other: {
    label: 'Other',
    icon: 'swap_horiz',
    placeholder: 'Transaction Reference / Receipt ID',
  },
};
