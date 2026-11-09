import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Directory',
  description: 'Manage contacts, peer trust connections, counterparties, and bilateral net balances.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/directory',
  },
  openGraph: {
    title: 'DebtSync — Peer Directory',
    description: 'Manage contacts, peer trust connections, counterparties, and bilateral net balances.',
    url: 'https://debt-sync.satya-nayak.dev/directory',
    images: [
      {
        url: '/screenshots/directory-desktop.png',
        width: 1200,
        height: 630,
        alt: 'DebtSync Peer Directory',
      },
    ],
  },
};

export default function DirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
