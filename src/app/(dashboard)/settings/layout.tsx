import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Manage profile preferences, currency, UPI IDs, bank settlement details, and account security.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/settings',
  },
  openGraph: {
    title: 'DebtSync — Settings & Preferences',
    description: 'Manage profile preferences, currency, UPI IDs, bank settlement details, and account security.',
    url: 'https://debt-sync.satya-nayak.dev/settings',
  },
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
