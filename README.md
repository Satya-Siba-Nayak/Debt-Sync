# DebtSync 💸

> Smart peer-to-peer ledger, interest engine, and debt management portal.

Built with **Next.js 16 (App Router)**, **Supabase PostgreSQL**, **Tailwind CSS**, and **Chart.js**, featuring the **Secure Ledger Aesthetics** corporate modern design system.

---

## 🚀 Features

- **Passwordless Magic Links**: Instant sign-in via Supabase Email Auth.
- **Shadow/Ghost Accounts**: Record debts with people before they join. When they sign up, their account and ledgers are automatically merged.
- **Dynamic Interest Engine**: 
  - 0% Interest-free micro-loans
  - Simple Interest (\(A = P(1 + rt)\))
  - Compound Interest (\(A = P(1 + r/n)^{nt}\)) across daily, weekly, monthly, or yearly schedules.
- **Live Interest Accrual Ticker**: Real-time ticker with animated decimals and micro-accrual velocity indicator.
- **Cross-Currency Support**: Default INR (₹), with support for USD, EUR, GBP, JPY, and live rates powered by the Fawaz Ahmed Currency API.
- **Smart Avalanche Settlement**: Bulk payment allocation algorithm paying off highest-interest loans first.
- **Analytics & Performance**: Debt age distribution histogram, 6-month liquidity forecast, and geometric Network Trust Score.
- **Theme Engine**: Light & Dark mode support with system-preference detection and zero-flash initialization.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, Turbopack)
- **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL + RLS)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Typography**: Hanken Grotesk & JetBrains Mono
- **Hosting**: Cloudflare Pages / Vercel

---

## 🏁 Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/Satya-Siba-Nayak/Debt-Sync.git
cd Debt-Sync
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` and add your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Apply Supabase Database Schema
Run the SQL migration in `supabase/migrations/001_initial_schema.sql` via your Supabase SQL Editor.

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

---

## 🌐 Deploy to Cloudflare Pages

1. In Cloudflare Dashboard, navigate to **Compute (Workers & Pages)** -> **Create application** -> **Pages** -> **Connect to Git**.
2. Select `Satya-Siba-Nayak/Debt-Sync`.
3. Set build configuration:
   - **Framework preset**: `Next.js`
   - **Build command**: `npm run build`
   - **Output directory**: `.next`
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Connect your custom domain (e.g. `debt-sync.satya-nayak.dev`).
