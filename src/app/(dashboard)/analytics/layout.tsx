import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Analytics & Trust Score',
  description: 'Server-calibrated Network Trust Score (300-850), repayment velocity, cashflow forecasts, and debt distribution insights.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/analytics',
  },
  openGraph: {
    title: 'DebtSync — Analytics & Network Trust Score',
    description: 'Server-calibrated Network Trust Score (300-850), repayment velocity, cashflow forecasts, and debt distribution insights.',
    url: 'https://debt-sync.satya-nayak.dev/analytics',
    images: [
      {
        url: '/screenshots/analytics-desktop-scrollup.png',
        width: 1200,
        height: 630,
        alt: 'DebtSync Analytics Hub',
      },
    ],
  },
};

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
