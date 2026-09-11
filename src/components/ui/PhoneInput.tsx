'use client';

import React, { useState, useEffect } from 'react';
import { COUNTRY_CODES, parsePhoneNumber, CountryCode } from '@/lib/constants/country-codes';

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  defaultCountryCode?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}

export function PhoneInput({
  value,
  onChange,
  defaultCountryCode = '+91',
  placeholder,
  disabled = false,
  required = false,
  className = '',
  id,
}: PhoneInputProps) {
  // Parse incoming value into dial code & national number
  const parsed = parsePhoneNumber(value, defaultCountryCode);
  const [selectedDialCode, setSelectedDialCode] = useState(parsed.dialCode);
  const [nationalNumber, setNationalNumber] = useState(parsed.nationalNumber);

  // Sync internal state when external value or default changes
  useEffect(() => {
    const p = parsePhoneNumber(value, defaultCountryCode);
    setSelectedDialCode(p.dialCode);
    setNationalNumber(p.nationalNumber);
  }, [value, defaultCountryCode]);

  const currentCountry =
    COUNTRY_CODES.find((c) => c.dialCode === selectedDialCode) ||
    COUNTRY_CODES.find((c) => c.dialCode === '+91') ||
    COUNTRY_CODES[0];

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCode = e.target.value;
    setSelectedDialCode(newCode);

    if (nationalNumber.trim().replace(/[^\d]/g, '')) {
      onChange(`${newCode} ${nationalNumber.trim()}`);
    }
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;

    // Auto-detect if user pastes an international number starting with '+'
    if (inputVal.trim().startsWith('+')) {
      const p = parsePhoneNumber(inputVal.trim(), selectedDialCode);
      setSelectedDialCode(p.dialCode);
      setNationalNumber(p.nationalNumber);

      if (p.nationalNumber.trim().replace(/[^\d]/g, '')) {
        onChange(`${p.dialCode} ${p.nationalNumber.trim()}`);
      } else {
        onChange('');
      }
      return;
    }

    // Keep numbers, spaces, and hyphens
    const sanitized = inputVal.replace(/[^\d\s-]/g, '');
    setNationalNumber(sanitized);

    const rawDigits = sanitized.replace(/[^\d]/g, '');
    if (rawDigits) {
      onChange(`${selectedDialCode} ${sanitized.trim()}`);
    } else {
      onChange('');
    }
  };

  return (
    <div
      className={`flex items-stretch rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] transition-all focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/15 ${
        disabled ? 'opacity-60 cursor-not-allowed' : ''
      } ${className}`}
    >
      {/* Country Code Selector Addon */}
      <div className="relative flex items-center bg-[var(--surface-container-low)] border-r border-[var(--outline-variant)]/30 rounded-l-xl px-2.5 py-2 cursor-pointer hover:bg-[var(--surface-container)] transition-colors">
        <span className="text-base select-none mr-1.5">{currentCountry.flag}</span>
        <span className="font-mono text-xs font-bold text-[var(--on-surface)] select-none">
          {selectedDialCode}
        </span>
        <span className="material-symbols-outlined text-[16px] text-[var(--outline)] ml-1 select-none pointer-events-none">
          arrow_drop_down
        </span>

        {/* Native Select Overlay with Full List of Countries */}
        <select
          value={selectedDialCode}
          onChange={handleCountryChange}
          disabled={disabled}
          aria-label="Select Country Code"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-sm"
        >
          {COUNTRY_CODES.map((country: CountryCode) => (
            <option key={`${country.code}-${country.dialCode}`} value={country.dialCode}>
              {country.flag} {country.name} ({country.dialCode})
            </option>
          ))}
        </select>
      </div>

      {/* National Number Input */}
      <input
        id={id}
        type="tel"
        value={nationalNumber}
        onChange={handleNumberChange}
        disabled={disabled}
        required={required}
        placeholder={placeholder || currentCountry.samplePlaceholder || '98765 43210'}
        className="flex-1 min-w-0 px-3.5 py-2.5 bg-transparent text-[var(--on-surface)] text-sm font-medium outline-none placeholder:text-[var(--outline)]"
      />
    </div>
  );
}
