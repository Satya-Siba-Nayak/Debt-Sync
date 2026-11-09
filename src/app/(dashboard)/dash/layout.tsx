import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Smart peer-to-peer ledger, real-time interest accrual ticker, and mutual debt management portal.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/dash',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: 'DebtSync — Dashboard',
    description: 'Smart peer-to-peer ledger, real-time interest accrual ticker, and mutual debt management portal.',
    url: 'https://debt-sync.satya-nayak.dev/dash',
    images: [
      {
        url: '/screenshots/dashboard-desktop.png',
        width: 1200,
        height: 630,
        alt: 'DebtSync Dashboard',
      },
    ],
  },
};

export default function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
