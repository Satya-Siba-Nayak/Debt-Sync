import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Accept Debt Agreement',
  description: 'Review and confirm bilateral peer debt or loan agreements with cryptographic verification on DebtSync.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/accept',
  },
  openGraph: {
    title: 'DebtSync — Accept Debt Agreement',
    description: 'Review and confirm bilateral peer debt or loan agreements with cryptographic verification on DebtSync.',
    url: 'https://debt-sync.satya-nayak.dev/accept',
  },
};

export default function AcceptLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
