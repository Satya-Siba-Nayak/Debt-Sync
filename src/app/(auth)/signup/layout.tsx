import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create a free DebtSync account to track peer debts, automate interest accrual, and split expenses.',
  alternates: {
    canonical: 'https://debt-sync.satya-nayak.dev/signup',
  },
  openGraph: {
    title: 'DebtSync — Create Free Account',
    description: 'Create a free DebtSync account to track peer debts, automate interest accrual, and split expenses.',
    url: 'https://debt-sync.satya-nayak.dev/signup',
  },
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
