import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Public Share Receipt',
  description: 'Cryptographic read-only public share receipt and agreement verification proof on DebtSync.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/share',
  },
  openGraph: {
    title: 'DebtSync — Public Share Receipt',
    description: 'Cryptographic read-only public share receipt and agreement verification proof on DebtSync.',
    url: 'https://debt-sync.satya-nayak.dev/share',
    images: [
      {
        url: '/screenshots/share-public-mobile.png',
        width: 1200,
        height: 630,
        alt: 'DebtSync Share Receipt',
      },
    ],
  },
};

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
