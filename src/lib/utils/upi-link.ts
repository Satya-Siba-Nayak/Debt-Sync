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
 * Generate a compliant, standard NPCI P2P UPI deeplink URL.
 *
 * @param upiId - Payee's UPI VPA (e.g. "satya@upi")
 * @param payeeName - Payee's display name
 * @param amount - Payment amount (optional, formatted to 2 decimals)
 * @param currency - Currency code (default: INR)
 * @param transactionNote - Payment note/reference (clean alphanumeric and spaces)
 * @returns Standard NPCI UPI deeplink string
 */
export function generateUPILink(
  upiId: string,
  payeeName: string,
  amount?: number,
  currency: string = 'INR',
  transactionNote?: string
): string {
  if (!upiId) return '';

  const cleanVpa = upiId.trim();
  // Clean payee name (alphanumeric and spaces only, max 50 chars)
  const cleanName = (payeeName || 'Counterparty')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);

  const parts: string[] = [];
  parts.push(`pa=${encodeURIComponent(cleanVpa)}`);
  if (cleanName) {
    parts.push(`pn=${encodeURIComponent(cleanName)}`);
  }

  if (amount && amount > 0) {
    parts.push(`am=${amount.toFixed(2)}`);
  }

  parts.push(`cu=${encodeURIComponent(currency.toUpperCase() || 'INR')}`);

  if (transactionNote) {
    // Clean note: alphanumeric and spaces only, strictly no #, %, &, ?, /
    const cleanNote = transactionNote
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50);

    if (cleanNote) {
      parts.push(`tn=${encodeURIComponent(cleanNote)}`);
    }
  }

  // CRITICAL NPCI P2P RULE:
  // Strictly omit 'mc' (Merchant Category Code) and 'mode' (Collect/Mandate).
  // Including mc='0000' or mode='02' causes bank switches (SBI, HDFC, ICICI, etc.)
  // to reject the transaction with "Declined by bank" or "Invalid Merchant / Unsigned Mandate"
  // because personal savings accounts cannot process merchant codes or unsigned mandates.

  return `upi://pay?${parts.join('&')}`;
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

export interface DetectedUPIApp {
  appId: 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'cred' | 'navi' | 'amazonpay' | 'jupiter' | 'slice' | 'revolut' | 'bank' | 'other';
  name: string;        // e.g. "Google Pay"
  shortName: string;   // e.g. "GPay"
  bank?: string;       // e.g. "HDFC Bank"
  icon: string;        // Material icon name
  badgeClass: string;  // Tailwind classes for pill styling
  isKnownApp: boolean;
}

/**
 * Automatically detects the UPI application and issuing bank from a UPI VPA handle.
 * e.g. user@okhdfcbank -> Google Pay (HDFC Bank)
 *      9876543210@ybl  -> PhonePe (Yes Bank)
 *      john@paytm      -> Paytm UPI
 */
export function detectUPIApp(upiId?: string | null): DetectedUPIApp {
  if (!upiId || typeof upiId !== 'string' || !upiId.includes('@')) {
    return {
      appId: 'other',
      name: 'UPI',
      shortName: 'UPI',
      icon: 'qr_code_2',
      badgeClass: 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/20',
      isKnownApp: false,
    };
  }

  const parts = upiId.trim().toLowerCase().split('@');
  if (parts.length < 2) {
    return {
      appId: 'other',
      name: 'UPI',
      shortName: 'UPI',
      icon: 'qr_code_2',
      badgeClass: 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/20',
      isKnownApp: false,
    };
  }

  const handle = parts[1];

  // 1. Google Pay (GPay) handles: @okhdfcbank, @okaxis, @oksbi, @okicici
  if (handle.startsWith('ok')) {
    const rawBank = handle.slice(2);
    let bankName = rawBank.toUpperCase();
    if (rawBank === 'hdfcbank') bankName = 'HDFC Bank';
    else if (rawBank === 'axis') bankName = 'Axis Bank';
    else if (rawBank === 'sbi') bankName = 'State Bank of India';
    else if (rawBank === 'icici') bankName = 'ICICI Bank';

    return {
      appId: 'gpay',
      name: 'Google Pay',
      shortName: 'GPay',
      bank: bankName,
      icon: 'smartphone',
      badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25',
      isKnownApp: true,
    };
  }

  // 2. PhonePe handles: @ybl (Yes Bank), @ibl (ICICI Bank), @axl (Axis Bank)
  if (['ybl', 'ibl', 'axl'].includes(handle)) {
    const bankName = handle === 'ybl' ? 'Yes Bank' : handle === 'ibl' ? 'ICICI Bank' : 'Axis Bank';
    return {
      appId: 'phonepe',
      name: 'PhonePe',
      shortName: 'PhonePe',
      bank: bankName,
      icon: 'smartphone',
      badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25',
      isKnownApp: true,
    };
  }

  // 3. Paytm handles: @paytm, @ptaxis, @pthdfc, @ptsbi, @ptyes
  if (handle.includes('paytm') || handle.startsWith('pt')) {
    let bankName = 'Paytm Payments Bank';
    if (handle === 'ptaxis') bankName = 'Axis Bank';
    else if (handle === 'pthdfc') bankName = 'HDFC Bank';
    else if (handle === 'ptsbi') bankName = 'SBI';
    else if (handle === 'ptyes') bankName = 'Yes Bank';

    return {
      appId: 'paytm',
      name: 'Paytm UPI',
      shortName: 'Paytm',
      bank: bankName,
      icon: 'account_balance_wallet',
      badgeClass: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
      isKnownApp: true,
    };
  }

  // 4. CRED handles: @cred, @abfspbl
  if (['cred', 'abfspbl'].includes(handle)) {
    return {
      appId: 'cred',
      name: 'CRED UPI',
      shortName: 'CRED',
      icon: 'credit_card',
      badgeClass: 'bg-neutral-500/10 text-neutral-800 dark:text-neutral-200 border-neutral-500/25',
      isKnownApp: true,
    };
  }

  // 5. BHIM / NPCI Official: @upi
  if (handle === 'upi') {
    return {
      appId: 'bhim',
      name: 'BHIM UPI',
      shortName: 'BHIM',
      icon: 'qr_code_2',
      badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
      isKnownApp: true,
    };
  }

  // 6. Navi: @navi, @navipay
  if (handle.includes('navi')) {
    return {
      appId: 'navi',
      name: 'Navi UPI',
      shortName: 'Navi',
      icon: 'savings',
      badgeClass: 'bg-blue-600/10 text-blue-700 dark:text-blue-300 border-blue-600/25',
      isKnownApp: true,
    };
  }

  // 7. Amazon Pay: @apl, @rapl, @amazonpay
  if (['apl', 'rapl', 'amazonpay'].includes(handle)) {
    return {
      appId: 'amazonpay',
      name: 'Amazon Pay',
      shortName: 'Amazon',
      icon: 'shopping_bag',
      badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
      isKnownApp: true,
    };
  }

  // 8. Jupiter: @jupiteraxis
  if (handle.includes('jupiter')) {
    return {
      appId: 'jupiter',
      name: 'Jupiter UPI',
      shortName: 'Jupiter',
      bank: 'Axis Bank',
      icon: 'savings',
      badgeClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
      isKnownApp: true,
    };
  }

  // 9. Slice handles: @slice, @sliceaxis, @slc, @slicepay
  if (['slice', 'sliceaxis', 'slc', 'slicepay'].includes(handle) || handle.includes('slice')) {
    const bankName = handle.includes('axis') ? 'Axis Bank' : 'Slice';
    return {
      appId: 'slice',
      name: 'Slice UPI',
      shortName: 'Slice',
      bank: bankName,
      icon: 'credit_card',
      badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
      isKnownApp: true,
    };
  }

  // 10. Revolut India handles: @revolut, @rev, @revolutybl, @revolutaxis
  if (['revolut', 'rev', 'revolutybl', 'revolutaxis'].includes(handle) || handle.includes('revolut')) {
    let bankName = 'Revolut';
    if (handle.includes('ybl')) bankName = 'Yes Bank';
    else if (handle.includes('axis')) bankName = 'Axis Bank';

    return {
      appId: 'revolut',
      name: 'Revolut India',
      shortName: 'Revolut',
      bank: bankName,
      icon: 'credit_card',
      badgeClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25',
      isKnownApp: true,
    };
  }

  // 11. Direct Bank handles:
  const directBanks: Record<string, string> = {
    sbi: 'SBI',
    hdfcbank: 'HDFC Bank',
    icici: 'ICICI Bank',
    axisbank: 'Axis Bank',
    kotak: 'Kotak Mahindra',
    pnb: 'PNB',
    barodampay: 'Bank of Baroda',
    bob: 'Bank of Baroda',
    cnrb: 'Canara Bank',
    indus: 'IndusInd Bank',
    federal: 'Federal Bank',
    idfcbank: 'IDFC FIRST Bank',
    postbank: 'India Post Payments Bank',
    ippb: 'India Post Payments Bank',
    airtel: 'Airtel Payments Bank',
    jio: 'Jio Payments Bank',
  };

  if (directBanks[handle]) {
    return {
      appId: 'bank',
      name: `${directBanks[handle]} UPI`,
      shortName: directBanks[handle],
      bank: directBanks[handle],
      icon: 'account_balance',
      badgeClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25',
      isKnownApp: true,
    };
  }

  return {
    appId: 'other',
    name: 'UPI',
    shortName: 'UPI',
    icon: 'qr_code_2',
    badgeClass: 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/20',
    isKnownApp: false,
  };
}

/**
 * Checks if a payment method code falls under the UPI network.
 * Note: Google Pay, PhonePe, and Paytm are all client apps running on UPI.
 */
export function isUPIMethod(method?: string | null): boolean {
  if (!method) return false;
  const m = method.toLowerCase();
  return ['upi', 'gpay', 'google_pay', 'phonepe', 'paytm', 'bhim', 'cred', 'slice', 'revolut'].includes(m);
}

/**
 * Primary payment modes presented to users.
 * Clean, standard, non-redundant categories.
 */
export const PRIMARY_PAYMENT_METHODS = ['upi', 'bank_transfer', 'cash', 'other'] as const;

/**
 * Common UPI TPAP apps that can be optionally designated under the UPI channel.
 */
export const UPI_SUB_APPS = [
  { id: 'gpay', name: 'Google Pay', shortName: 'GPay' },
  { id: 'phonepe', name: 'PhonePe', shortName: 'PhonePe' },
  { id: 'paytm', name: 'Paytm', shortName: 'Paytm' },
  { id: 'bhim', name: 'BHIM', shortName: 'BHIM' },
  { id: 'cred', name: 'CRED', shortName: 'CRED' },
  { id: 'slice', name: 'Slice', shortName: 'Slice' },
  { id: 'revolut', name: 'Revolut India', shortName: 'Revolut' },
  { id: 'other', name: 'Other UPI', shortName: 'Other' },
] as const;

/**
 * Standard payment method definitions.
 */
export const PAYMENT_METHOD_LABELS: Record<string, { label: string; icon: string; placeholder: string; description: string }> = {
  upi: {
    label: 'UPI',
    icon: 'qr_code_2',
    placeholder: '12-digit UPI Transaction Ref (UTR)',
    description: 'Instant transfer via Google Pay, PhonePe, Paytm, BHIM, CRED, Slice, Revolut, or Bank UPI',
  },
  bank_transfer: {
    label: 'Bank Transfer',
    icon: 'account_balance',
    placeholder: 'NEFT / IMPS / RTGS Reference Number',
    description: 'Direct account-to-account net banking transfer',
  },
  cash: {
    label: 'Cash',
    icon: 'payments',
    placeholder: '',
    description: 'Physical in-person cash exchange',
  },
  other: {
    label: 'Other',
    icon: 'swap_horiz',
    placeholder: 'Transaction Reference / Receipt ID',
    description: 'Cheque, card payment, or external settlement',
  },
  // Sub-app aliases for backward compatibility with previous logs
  gpay: {
    label: 'Google Pay (UPI)',
    icon: 'smartphone',
    placeholder: 'GPay 12-digit UTR ID',
    description: 'UPI transfer via Google Pay',
  },
  phonepe: {
    label: 'PhonePe (UPI)',
    icon: 'smartphone',
    placeholder: 'PhonePe 12-digit UTR ID',
    description: 'UPI transfer via PhonePe',
  },
  paytm: {
    label: 'Paytm (UPI)',
    icon: 'account_balance_wallet',
    placeholder: 'Paytm Order/Transaction ID',
    description: 'UPI transfer via Paytm',
  },
  slice: {
    label: 'Slice (UPI)',
    icon: 'credit_card',
    placeholder: 'Slice UTR / Txn Reference',
    description: 'UPI transfer via Slice',
  },
  revolut: {
    label: 'Revolut (UPI)',
    icon: 'credit_card',
    placeholder: 'Revolut Reference ID',
    description: 'UPI transfer via Revolut India',
  },
};

/**
 * Formats a payment method with its channel and detected/designated UPI app.
 */
export function formatPaymentMethodDisplay(
  method?: string | null,
  transactionRef?: string | null,
  upiId?: string | null
): {
  channel: 'upi' | 'bank_transfer' | 'cash' | 'other';
  channelLabel: string;
  appLabel?: string;
  fullLabel: string;
  icon: string;
  badgeClass: string;
} {
  const m = (method || 'other').toLowerCase();

  if (isUPIMethod(m)) {
    let appLabel: string | undefined;
    let badgeClass = 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/20';

    if (m === 'gpay' || m === 'google_pay') {
      appLabel = 'Google Pay';
      badgeClass = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25';
    } else if (m === 'phonepe') {
      appLabel = 'PhonePe';
      badgeClass = 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25';
    } else if (m === 'paytm') {
      appLabel = 'Paytm';
      badgeClass = 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25';
    } else if (m === 'cred') {
      appLabel = 'CRED';
      badgeClass = 'bg-neutral-500/10 text-neutral-800 dark:text-neutral-200 border-neutral-500/25';
    } else if (m === 'slice') {
      appLabel = 'Slice';
      badgeClass = 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25';
    } else if (m === 'revolut') {
      appLabel = 'Revolut';
      badgeClass = 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25';
    } else if (upiId) {
      const detected = detectUPIApp(upiId);
      if (detected.isKnownApp) {
        appLabel = detected.name;
        badgeClass = detected.badgeClass;
      }
    }

    return {
      channel: 'upi',
      channelLabel: 'UPI',
      appLabel,
      fullLabel: appLabel ? `UPI (${appLabel})` : 'UPI',
      icon: 'qr_code_2',
      badgeClass,
    };
  }

  if (m === 'bank_transfer') {
    return {
      channel: 'bank_transfer',
      channelLabel: 'Bank Transfer',
      fullLabel: 'Bank Transfer',
      icon: 'account_balance',
      badgeClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25',
    };
  }

  if (m === 'cash') {
    return {
      channel: 'cash',
      channelLabel: 'Cash',
      fullLabel: 'Cash',
      icon: 'payments',
      badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    };
  }

  return {
    channel: 'other',
    channelLabel: 'Other',
    fullLabel: 'Other',
    icon: 'swap_horiz',
    badgeClass: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-500/25',
  };
}

export interface UPIAppLauncher {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  badgeClass: string;
  androidIntent: string;
  iosScheme?: string;
  fallbackScheme: string;
}

export const UPI_POPULAR_APPS: UPIAppLauncher[] = [
  {
    id: 'gpay',
    name: 'Google Pay',
    shortName: 'GPay',
    icon: 'smartphone',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25',
    androidIntent: 'intent://#Intent;package=com.google.android.apps.nbu.paisa.user;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end',
    iosScheme: 'gpay://',
    fallbackScheme: 'gpay://',
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    shortName: 'PhonePe',
    icon: 'smartphone',
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25',
    androidIntent: 'intent://#Intent;package=com.phonepe.app;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end',
    iosScheme: 'phonepe://',
    fallbackScheme: 'phonepe://',
  },
  {
    id: 'paytm',
    name: 'Paytm',
    shortName: 'Paytm',
    icon: 'account_balance_wallet',
    badgeClass: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
    androidIntent: 'intent://#Intent;package=net.one97.paytm;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end',
    iosScheme: 'paytmmp://',
    fallbackScheme: 'paytmmp://',
  },
  {
    id: 'cred',
    name: 'CRED',
    shortName: 'CRED',
    icon: 'credit_card',
    badgeClass: 'bg-neutral-500/10 text-neutral-800 dark:text-neutral-200 border-neutral-500/25',
    androidIntent: 'intent://#Intent;package=com.dreamplug.androidapp;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end',
    iosScheme: 'cred://',
    fallbackScheme: 'cred://',
  },
  {
    id: 'bhim',
    name: 'BHIM UPI',
    shortName: 'BHIM',
    icon: 'qr_code_2',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    androidIntent: 'intent://#Intent;package=in.org.npci.upiapp;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end',
    iosScheme: 'upi://',
    fallbackScheme: 'upi://',
  },
];

/**
 * Directly launches a UPI application on mobile via OS package launcher intent,
 * avoiding the browser-originated P2P `upi://pay` intent that bank switches decline.
 */
export function launchUPIApp(appId: string): boolean {
  if (typeof window === 'undefined') return false;

  const app = UPI_POPULAR_APPS.find((a) => a.id === appId);
  if (!app) {
    window.location.href = 'upi://';
    return true;
  }

  const ua = (navigator.userAgent || '').toLowerCase();
  const isAndroid = /android/i.test(ua);
  const isIOS = /iphone|ipad|ipod/i.test(ua);

  try {
    if (isAndroid && app.androidIntent) {
      window.location.href = app.androidIntent;
    } else if (isIOS && app.iosScheme) {
      window.location.href = app.iosScheme;
    } else {
      window.location.href = app.fallbackScheme;
    }
    return true;
  } catch (err) {
    console.error('Failed to launch UPI app:', err);
    return false;
  }
}

