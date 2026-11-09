import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Transactions',
  description: 'Search, filter, and audit all peer-to-peer debts, loans, repayments, and historical receipts.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/transactions',
  },
  openGraph: {
    title: 'DebtSync — Transactions & Ledger',
    description: 'Search, filter, and audit all peer-to-peer debts, loans, repayments, and historical receipts.',
    url: 'https://debt-sync.satya-nayak.dev/transactions',
    images: [
      {
        url: '/screenshots/debt-detail-upscroll-desktop.png',
        width: 1200,
        height: 630,
        alt: 'DebtSync Ledger & Transactions',
      },
    ],
  },
};

export default function TransactionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
