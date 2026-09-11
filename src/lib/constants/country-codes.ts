export interface CountryCode {
  name: string;
  code: string; // ISO 2-letter
  dialCode: string; // e.g. +91
  flag: string;
  samplePlaceholder?: string;
}

export const COUNTRY_CODES: CountryCode[] = [
  { name: 'India', code: 'IN', dialCode: '+91', flag: '🇮🇳', samplePlaceholder: '98765 43210' },
  { name: 'United States', code: 'US', dialCode: '+1', flag: '🇺🇸', samplePlaceholder: '(555) 000-0000' },
  { name: 'United Kingdom', code: 'GB', dialCode: '+44', flag: '🇬🇧', samplePlaceholder: '7911 123456' },
  { name: 'United Arab Emirates', code: 'AE', dialCode: '+971', flag: '🇦🇪', samplePlaceholder: '50 123 4567' },
  { name: 'Canada', code: 'CA', dialCode: '+1', flag: '🇨🇦', samplePlaceholder: '(555) 000-0000' },
  { name: 'Australia', code: 'AU', dialCode: '+61', flag: '🇦🇺', samplePlaceholder: '412 345 678' },
  { name: 'Singapore', code: 'SG', dialCode: '+65', flag: '🇸🇬', samplePlaceholder: '8123 4567' },
  { name: 'Germany', code: 'DE', dialCode: '+49', flag: '🇩🇪', samplePlaceholder: '151 12345678' },
  { name: 'France', code: 'FR', dialCode: '+33', flag: '🇫🇷', samplePlaceholder: '6 12 34 56 78' },
  { name: 'Saudi Arabia', code: 'SA', dialCode: '+966', flag: '🇸🇦', samplePlaceholder: '50 123 4567' },
  { name: 'Qatar', code: 'QA', dialCode: '+974', flag: '🇶🇦', samplePlaceholder: '3312 3456' },
  { name: 'Kuwait', code: 'KW', dialCode: '+965', flag: '🇰🇼', samplePlaceholder: '9123 4567' },
  { name: 'Oman', code: 'OM', dialCode: '+968', flag: '🇴🇲', samplePlaceholder: '9123 4567' },
  { name: 'Bahrain', code: 'BH', dialCode: '+973', flag: '🇧🇭', samplePlaceholder: '3612 3456' },
  { name: 'Malaysia', code: 'MY', dialCode: '+60', flag: '🇲🇾', samplePlaceholder: '12-345 6789' },
  { name: 'Indonesia', code: 'ID', dialCode: '+62', flag: '🇮🇩', samplePlaceholder: '812-3456-7890' },
  { name: 'Japan', code: 'JP', dialCode: '+81', flag: '🇯🇵', samplePlaceholder: '90-1234-5678' },
  { name: 'China', code: 'CN', dialCode: '+86', flag: '🇨🇳', samplePlaceholder: '138 0000 0000' },
  { name: 'South Korea', code: 'KR', dialCode: '+82', flag: '🇰🇷', samplePlaceholder: '10-1234-5678' },
  { name: 'Bangladesh', code: 'BD', dialCode: '+880', flag: '🇧🇩', samplePlaceholder: '1712-345678' },
  { name: 'Pakistan', code: 'PK', dialCode: '+92', flag: '🇵🇰', samplePlaceholder: '300 1234567' },
  { name: 'Sri Lanka', code: 'LK', dialCode: '+94', flag: '🇱🇰', samplePlaceholder: '71 234 5678' },
  { name: 'Nepal', code: 'NP', dialCode: '+977', flag: '🇳🇵', samplePlaceholder: '984-1234567' },
  { name: 'Netherlands', code: 'NL', dialCode: '+31', flag: '🇳🇱', samplePlaceholder: '6 12345678' },
  { name: 'Switzerland', code: 'CH', dialCode: '+41', flag: '🇨🇭', samplePlaceholder: '79 123 45 67' },
  { name: 'Sweden', code: 'SE', dialCode: '+46', flag: '🇸🇪', samplePlaceholder: '70-123 45 67' },
  { name: 'Spain', code: 'ES', dialCode: '+34', flag: '🇪🇸', samplePlaceholder: '612 34 56 78' },
  { name: 'Italy', code: 'IT', dialCode: '+39', flag: '🇮🇹', samplePlaceholder: '312 345 6789' },
  { name: 'New Zealand', code: 'NZ', dialCode: '+64', flag: '🇳🇿', samplePlaceholder: '21 123 4567' },
  { name: 'South Africa', code: 'ZA', dialCode: '+27', flag: '🇿🇦', samplePlaceholder: '71 123 4567' },
  { name: 'Nigeria', code: 'NG', dialCode: '+234', flag: '🇳🇬', samplePlaceholder: '802 123 4567' },
  { name: 'Kenya', code: 'KE', dialCode: '+254', flag: '🇰🇪', samplePlaceholder: '712 345678' },
  { name: 'Brazil', code: 'BR', dialCode: '+55', flag: '🇧🇷', samplePlaceholder: '11 91234-5678' },
  { name: 'Mexico', code: 'MX', dialCode: '+52', flag: '🇲🇽', samplePlaceholder: '55 1234 5678' },
  { name: 'Philippines', code: 'PH', dialCode: '+63', flag: '🇵🇭', samplePlaceholder: '917 123 4567' },
  { name: 'Thailand', code: 'TH', dialCode: '+66', flag: '🇹🇭', samplePlaceholder: '81 234 5678' },
  { name: 'Vietnam', code: 'VN', dialCode: '+84', flag: '🇻🇳', samplePlaceholder: '91 234 56 78' },
  { name: 'Hong Kong', code: 'HK', dialCode: '+852', flag: '🇭🇰', samplePlaceholder: '9123 4567' },
  { name: 'Taiwan', code: 'TW', dialCode: '+886', flag: '🇹🇼', samplePlaceholder: '912 345 678' },
  { name: 'Ireland', code: 'IE', dialCode: '+353', flag: '🇮🇪', samplePlaceholder: '85 123 4567' },
  { name: 'Poland', code: 'PL', dialCode: '+48', flag: '🇵🇱', samplePlaceholder: '512 345 678' },
  { name: 'Norway', code: 'NO', dialCode: '+47', flag: '🇳🇴', samplePlaceholder: '412 34 567' },
  { name: 'Denmark', code: 'DK', dialCode: '+45', flag: '🇩🇰', samplePlaceholder: '20 12 34 56' },
  { name: 'Finland', code: 'FI', dialCode: '+358', flag: '🇫🇮', samplePlaceholder: '41 2345678' },
  { name: 'Austria', code: 'AT', dialCode: '+43', flag: '🇦🇹', samplePlaceholder: '664 1234567' },
  { name: 'Belgium', code: 'BE', dialCode: '+32', flag: '🇧🇪', samplePlaceholder: '470 12 34 56' },
  { name: 'Portugal', code: 'PT', dialCode: '+351', flag: '🇵🇹', samplePlaceholder: '912 345 678' },
  { name: 'Greece', code: 'GR', dialCode: '+30', flag: '🇬🇷', samplePlaceholder: '691 234 5678' },
  { name: 'Turkey', code: 'TR', dialCode: '+90', flag: '🇹🇷', samplePlaceholder: '501 234 56 78' },
  { name: 'Egypt', code: 'EG', dialCode: '+20', flag: '🇪🇬', samplePlaceholder: '100 123 4567' },
  { name: 'Israel', code: 'IL', dialCode: '+972', flag: '🇮🇱', samplePlaceholder: '50-123-4567' },
];

const SORTED_BY_DIAL_LENGTH = [...COUNTRY_CODES].sort(
  (a, b) => b.dialCode.length - a.dialCode.length
);

export function parsePhoneNumber(
  rawPhone: string | null | undefined,
  defaultCountryCode = '+91'
): { dialCode: string; nationalNumber: string } {
  if (!rawPhone || !rawPhone.trim()) {
    return { dialCode: defaultCountryCode, nationalNumber: '' };
  }

  const clean = rawPhone.trim();

  if (clean.startsWith('+')) {
    for (const country of SORTED_BY_DIAL_LENGTH) {
      if (clean.startsWith(country.dialCode)) {
        const remaining = clean.slice(country.dialCode.length).trim();
        return { dialCode: country.dialCode, nationalNumber: remaining };
      }
    }
    const firstSpace = clean.indexOf(' ');
    if (firstSpace > 1) {
      return {
        dialCode: clean.slice(0, firstSpace),
        nationalNumber: clean.slice(firstSpace + 1).trim(),
      };
    }
  }

  // If no '+' prefix, check common Indian number formats:
  const digitsOnly = clean.replace(/[^\d]/g, '');

  // 12 digits starting with 91 (e.g. 919876543210) -> extract +91 dial code
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return {
      dialCode: '+91',
      nationalNumber: digitsOnly.slice(2),
    };
  }

  // 11 digits starting with 0 (e.g. 09876543210) -> strip leading trunk 0
  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    return {
      dialCode: defaultCountryCode,
      nationalNumber: digitsOnly.slice(1),
    };
  }

  return { dialCode: defaultCountryCode, nationalNumber: clean };
}

export function formatPhoneNumber(dialCode: string, nationalNumber: string): string {
  const digits = nationalNumber.replace(/[^\d]/g, '');
  if (!digits) return '';
  return `${dialCode.trim()} ${nationalNumber.trim()}`;
}
