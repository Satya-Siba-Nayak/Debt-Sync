import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to DebtSync using Magic Link, Google OAuth, or credentials to access your peer ledger.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/login',
  },
  openGraph: {
    title: 'DebtSync — Sign In',
    description: 'Sign in to DebtSync using Magic Link, Google OAuth, or credentials to access your peer ledger.',
    url: 'https://debt-sync.satya-nayak.dev/login',
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
