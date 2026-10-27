# DebtSync — Architecture, Systems & Implementation Reference (`DOCS.md`)

> **Live Application**: [https://debt-sync.satya-nayak.dev/](https://debt-sync.satya-nayak.dev/)  
> **Sample Public Share Receipt**: [Inspect Live Read-Only Receipt](https://debt-sync.satya-nayak.dev/share?id=81d9115e-d237-49eb-8be5-16bb3a9ea408&token=gsh_hitjra5bqn7dy2tsdf)  
> **Support & Inquiries**: `support@satya-nayak.dev` | [Contact Portal](https://debt-sync.satya-nayak.dev/contact)

This document serves as the comprehensive technical reference for **DebtSync**, detailing every system, algorithm, database migration, security invariant, API endpoint, and UI architecture implemented across the platform.

---

## Table of Contents

1. [System Overview & Core Philosophy](#1-system-overview--core-philosophy)
2. [Server-Calibrated Network Trust Score (`300–850`)](#2-server-calibrated-network-trust-score-300850)
3. [Dynamic Interest Accrual & Financial Engine](#3-dynamic-interest-accrual--financial-engine)
4. [Dual Sharing Architecture (Participants vs. Public Token Links)](#4-dual-sharing-architecture-participants-vs-public-token-links)
5. [Public Website, Legal Pages & Session-Aware Browsing (`?home=true`)](#5-public-website-legal-pages--session-aware-browsing-hometrue)
6. [Authentication, Onboarding & Mandatory Notification Opt-In](#6-authentication-onboarding--mandatory-notification-opt-in)
7. [Multi-Channel Notification & Reminder Architecture](#7-multi-channel-notification--reminder-architecture)
8. [Secure Discord Webhook Integration & Rate Limiting](#8-secure-discord-webhook-integration--rate-limiting)
9. [Admin Observatory vs. User Mode Partitioning](#9-admin-observatory-vs-user-mode-partitioning)
10. [UI/UX & Responsive Layout Architecture](#10-uiux--responsive-layout-architecture)
11. [Supabase Database Schema & Migrations (`001` – `027`)](#11-supabase-database-schema--migrations-001--027)
12. [Environment Variables & Deployment Reference](#12-environment-variables--deployment-reference)
13. [Key Bug Fixes & Edge-Case Protections](#13-key-bug-fixes--edge-case-protections)

---

## 1. System Overview & Core Philosophy

**DebtSync** is a peer-to-peer ledger, real-time interest accrual engine, and mutual debt verification platform. Unlike unilateral note-taking apps, DebtSync enforces **bilateral cryptographic consensus**:
1. **Agreement Proposal**: A lender or borrower records a principal amount, currency, optional APR (Simple or Compounding), due date, or group split bill.
2. **Mutual Acceptance**: The counterparty receives an instant notification or invite link. Unaccepted (`pending`) proposals never inflate active portfolio balances (`totalLent`, `totalOwed`, `netPosition`) until explicitly accepted by the counterparty.
3. **Verified Repayments**: Borrowers log repayments tagged by method (`UPI`, `Bank Transfer`, `Cash`, `Other`), and lenders verify or dispute receipts with 1 tap.
4. **Shadow / Ghost Profiles**: Users can record transactions with contacts by email or phone number before they register. When that person signs up, all historical ledgers and split bills automatically bind to their authenticated profile.

---

## 2. Server-Calibrated Network Trust Score (`300–850`)

### Why Server-Side Calibration Exists
Under Supabase Row-Level Security (RLS), a regular client can only query `debts` and `payments` where `auth.uid()` is the `lender_id` or `borrower_id`. Previously, client-only trust score calculations caused User A viewing User B's profile to only compute User B's score from debts shared *between A and B*, while User B saw their score across *all* counterparties. Furthermore, device timezone offsets on `YYYY-MM-DD` due dates and partial session caches caused scores to drift across devices.

### Architecture (`supabase/migrations/027_server_dynamic_network_score.sql` & `src/lib/utils/trust-score.ts`)
- **PostgreSQL `SECURITY DEFINER` RPCs**:
  - `public.calculate_user_trust_score(p_user_id UUID) RETURNS JSONB`
  - `public.get_batch_trust_scores(p_user_ids UUID[]) RETURNS JSONB`
- Both RPCs evaluate the target user's complete non-purged ledger across the entire platform on the server using **UTC calendar dates** (`(now() AT TIME ZONE 'UTC')::DATE`) and authoritative `is_isolated` / `is_verified` flags from `public.profiles`.
- Private transaction rows and counterparty identities are never exposed—only the calibrated score (`300–850`, or `-1` if unrated) and aggregate pillar metrics are returned.
- Client-side fallback in `src/lib/utils/trust-score.ts` maintains **100% mathematical parity** with the SQL RPC and caches server responses in memory + `sessionStorage` (`debtsync_server_trust_scores_v2`) with instant cache invalidation on ledger mutations.

### Qualification & 4-Pillar Formula
- **Unrated (`-1` / `No Score`)**: Returned if the user has **0 confirmed agreements** (`active`, `settled`, or `disputed`). Users with only `pending` or `declined` requests remain unrated (`-1`).
- **Isolated Account (`300` / `Restricted`)**: Accounts restricted by an administrator (`is_isolated = true`) are hard-capped at the `300` floor.
- **Weighted Pillars** (mapped onto the `300–850` FICO-style range: `300 + round(composite_0_to_100 * 5.5)`):
  1. **Repayment Punctuality (`38%` weight)**:
     - Base `78/100`.
     - Rewards on-time settled agreements (up to `+22 pts`), verified repayment count (up to `+8 pts`), and active agreements in good standing with zero overdue obligations (`+15 pts`).
     - Graduated UTC overdue penalties for borrowed active debts past due date: `-25` per overdue debt, `-10` additional for `> 7 days` overdue, and `-30` additional for `> 30 days` severe delinquency.
  2. **Principal Clearance & Capital Velocity (`27%` weight)**:
     - Evaluates verified principal repaid vs. total borrowed volume (`42 + clearanceRatio * 46`), plus a settled agreement completion bonus (up to `+12 pts`).
     - For `settled` borrowed debts, cleared volume is `GREATEST(principal, verifiedPaidOnDebt)` so debts marked settled directly via "Mark as Settled" without individual payment rows still count as 100% cleared.
     - Blends 50% of settled lending liquidity volume so active lenders who also borrow are accurately rewarded for capital velocity.
  3. **Verified Peer Network Breadth (`15%` weight)**:
     - Base `40/100`.
     - Diminishing-returns peer scaling (`+18 pts/peer` for the first 4 unique confirmed counterparties, `+7 pts/peer` thereafter, up to `+55 pts`).
     - Confirmed volume bonus (up to `+15 pts`) and Verified Profile Identity bonus (`+20 pts` when `is_verified = true`).
  4. **Dispute-Free Consensus (`20%` weight)**:
     - Starts at `100/100`.
     - Deducts `-45 pts` per active disputed agreement, `-20 pts` per `[DISPUTED]` payment record, and `-12 pts` per rejected proposal **only** when the user was the creator (`created_by = user_id`) and has `>= 2` declined outbound proposals (protecting recipients who decline bogus requests).
- **Confidence Damping**: Users with only 1–2 confirmed agreements are smoothly damped toward a neutral `675` baseline (`65%` weight at 1 debt, `85%` weight at 2 debts, `100%` full weight at `3+` confirmed debts).

---

## 3. Dynamic Interest Accrual & Financial Engine

Implemented in `src/lib/utils/interest.ts` and `src/lib/utils/due-date.ts`:
- **Interest Modes**:
  - `none`: `0%` interest-free peer ledger.
  - `simple`: \(A = P(1 + r \cdot t)\), where \(t\) is elapsed time in years from `start_date`.
  - `compound`: \(A = P(1 + \frac{r}{n})^{n \cdot t}\), supporting `daily` (\(n = 365\)), `weekly` (\(n = 52\)), `monthly` (\(n = 12\)), and `yearly` (\(n = 1\)) compounding frequencies.
- **Live Sub-Second Accrual Ticker**:
  - `LiveInterestTicker.tsx` computes continuous interest growth down to the second on active interest-bearing agreements.
- **Avalanche Bulk Settlement**:
  - Allocates lump-sum repayments across multiple active debts with a counterparty by prioritizing the highest APR agreements first to minimize future interest accrual.
- **Timezone-Safe Due Date Engine (`src/lib/utils/due-date.ts`)**:
  - Parses `YYYY-MM-DD` strings by extracting explicit year, month, and day integers into local calendar dates instead of `new Date('YYYY-MM-DD')` (which shifts by UTC offset).
  - Never marks `pending` (unaccepted) or `declined` agreements as `Overdue`.

---

## 4. Dual Sharing Architecture (Participants vs. Public Token Links)

Implemented in `src/app/share/page.tsx` and transaction detail drawers:

1. **Participants-Only Link (`/share?id=<uuid>&mode=participants`)**:
   - Restricted strictly to verified agreement participants (`lender_id`, `borrower_id`, or split group members).
   - Unauthenticated visitors see a clean verification gate prompting them to sign in or sign up with their participant email/phone while preserving all query parameters (`?id=...&mode=participants`).
2. **Global Public Share Receipt (`/share?id=<uuid>&token=gsh_<token>`)**:
   - Viewable by anyone with the cryptographic `gsh_` token without logging in.
   - **Privacy Redaction**: Sensitive emails are masked (`s***k@domain.com`), phone numbers and private counterparty notes are hidden, and mutation controls are disabled for outside viewers.
   - **Participant Recognition**: If the logged-in lender or borrower opens the public link, they automatically see their full unmasked participant controls.
   - **Live Example**: `https://debt-sync.satya-nayak.dev/share?id=81d9115e-d237-49eb-8be5-16bb3a9ea408&token=gsh_hitjra5bqn7dy2tsdf`
3. **Mobile Share Sheet Immunity**:
   - All `navigator.share({ title, text, url })` calls append `\n${targetUrl}` directly inside `text` so mobile apps like WhatsApp (which strip the `url` field when `text` is present) always include the clickable link.

---

## 5. Public Website, Legal Pages & Session-Aware Browsing (`?home=true`)

### Public Routes & Sitemap (`public/sitemap.xml` & `public/robots.txt`)
- **`/` (`src/app/page.tsx`)**: Full product landing page with interactive Desktop & Mobile screenshot showcase (`public/screenshots/`), 3-step workflow guide, live Public Share Receipt demo, FAQ, and theme toggle.
- **`/signup` & `/login` (`src/app/(auth)/`)**: Passwordless Magic Link, Google OAuth, and credential authentication with redirect query parameter preservation.
- **`/share` & `/accept`**: Public receipt verification portal (including the live sample receipt `/share?id=81d9115e-d237-49eb-8be5-16bb3a9ea408&token=gsh_hitjra5bqn7dy2tsdf`) and bilateral agreement acceptance portal.
- **`/terms` (`src/app/terms/page.tsx`)**: Comprehensive Terms of Service covering P2P ledger consensus, informational non-custodial nature, and user conduct.
- **`/privacy` (`src/app/privacy/page.tsx`)**: Digital Personal Data Protection (DPDP) Act compliant Privacy Policy detailing RLS isolation, public link masking, and 48-hour account/data deletion rights.
- **`/contact` (`src/app/contact/page.tsx`)**: Support & Inquiry center with dynamic category routing (`General Website Inquiry`, `Account & Login Support`, `Privacy / Data Deletion Request`, `Bug / Security Report`, `Feedback & Feature Request`).
- **SEO Sitemap & Crawler Rules**: `public/sitemap.xml` indexes all public routes and product showcase images (`xmlns:image`), while `public/robots.txt` explicitly allows public pages/screenshots and disallows private authenticated workspace routes (`/dash`, `/transactions`, `/directory`, `/analytics`, `/settings`, `/admin`, `/api/`).

### Session-Aware Website Browsing for Logged-In Users
- **First-Visit Dashboard Redirect**: When an authenticated user opens the app fresh (`/`), they are automatically directed to `/dash` so the PWA opens straight into their workspace.
- **Explicit Public Website Browsing (`?home=true`)**:
  - Logged-in users can visit the public website at any time via the compact **"About"** pill in the desktop Sidebar (`src/components/layout/Sidebar.tsx`) or the mobile Profile menu (`src/components/layout/TopBar.tsx`), which navigates to `/?home=true`.
  - Setting `?home=true` writes `sessionStorage.setItem('debtsync_public_browsing', 'true')` (`src/components/layout/PublicNavbar.tsx`).
  - While this session flag is active, clicking the DebtSync logo or navigating across `/`, `/privacy`, `/terms`, and `/contact` keeps `/?home=true` intact and displays a prominent **"Dashboard"** button in the navbar instead of forcibly redirecting the user back to `/dash`.
  - Clicking **"Dashboard"** clears the `debtsync_public_browsing` flag and returns the user to `/dash`.

---

## 6. Authentication, Onboarding & Mandatory Notification Opt-In

Implemented in `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/login/page.tsx`, and `src/components/notifications/NotificationPromptBanner.tsx`:

- **Mandatory Signup Consents**:
  1. **RCS / SMS & Account Activity Consent (Required)**: Users must check the compulsory consent checkbox acknowledging essential RCS/SMS & account verification alerts (explicitly stating that **non-active accounts will never receive promotional spam**).
  2. **Notification Channel Selection (Required — At Least One)**: Users must enable at least one delivery channel during registration (`Email Notifications` or `Device Push Notifications`) before the signup form can be submitted.
- **Post-Login RCS/SMS Opt-In Card**:
  - Existing users who haven't yet opted into RCS/SMS alerts see a minimal, non-intrusive opt-in card on their Dashboard/Settings (clearly noting zero spam for inactive accounts).

---

## 7. Multi-Channel Notification & Reminder Architecture

- **Web Push Notifications (`public/sw.js` & `src/lib/utils/push-notifications.ts`)**:
  - Service Worker handles background Web Push events (`push`, `notificationclick`) using VAPID keys (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) and stores subscriptions in `public.push_subscriptions`.
- **Transactional Emails (`src/app/api/notifications/email/route.ts` & Supabase Edge Function `notify`)**:
  - Dispatches styled HTML emails for `ghost_account_invite`, `payment_request`, `debt_recorded`, `split_bill_request`, `payment_reminder`, and `due_date_reminder`.
  - Includes per-recipient cooldown rate limiting (`60m` for ghost invites, `30m` for manual payment reminders, `15m` for transaction updates) and skips internal `@phone.debtsync.local` shadow identifiers.
- **Automated Due-Date Reminders (`src/app/api/reminders/due-date/route.ts` & `026_payment_and_due_date_reminders.sql`)**:
  - Checks active debts due tomorrow (`diffDays === 1` in UTC calendar days), logs a `due_date_reminder` entry in `activity_log` to guarantee idempotency (at most once per due date / 48h window), and dispatches both Push and Email alerts to the borrower and lender.

---

## 8. Secure Discord Webhook Integration & Rate Limiting

To prevent webhook URL harvesting when the repository is public on GitHub:
- **Zero Client / Repo Exposure**:
  - Webhook URLs are never hardcoded in source files or prefixed with `NEXT_PUBLIC_`.
  - Both `/api/contact` (`src/app/api/contact/route.ts`) and `/api/bug-report` (`src/app/api/bug-report/route.ts`) read `process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_BUG_WEBHOOK_URL` exclusively on the server.
- **Public Contact Inquiry Routing (`/api/contact`)**:
  - Routes website inquiries directly to the server-side Discord webhook embed.
  - **Conditional Field Requirements**: For general inquiries (`general_inquiry` / `feedback`), phone number and additional metadata are **optional**—only `email`, `name`, and `message` are required.
  - **Strict 2/Day Device + IP Rate Limit**: Enforces a maximum of **2 inquiries per 24-hour rolling window** per device/IP using a dual-layer check:
    1. Server-side `deviceFingerprint + clientIp` rolling 24h counter + `HttpOnly` cookie (`debtsync_contact_rl`).
    2. Client-side `localStorage` (`debtsync_contact_submissions_v1`) quota display in `src/app/contact/page.tsx`.
- **PWA Bug & Issue Reporting (`/api/bug-report` & `src/components/modals/BugReportModal.tsx`)**:
  -Accessible from the compact **"Report"** pill in the desktop Sidebar (placed side-by-side with **"About"**) and in the mobile Profile dropdown menu.
  - Sends structured embeds (severity, category, route URL, viewport metadata, user identifier, and reproduction steps) to Discord via `/api/bug-report`.

---

## 9. Admin Observatory vs. User Mode Partitioning

Implemented in `src/app/(dashboard)/admin/page.tsx`, `src/components/admin/AdminAnalyticsView.tsx`, and `src/components/layout/Sidebar.tsx`:
- **Strict Privilege Separation**:
  - Superusers can toggle between **User Mode** (`viewMode === 'user'`) and **Admin Mode** (`viewMode === 'admin'`) via the sidebar/profile view switcher (`debtsync:view_mode_changed` custom event).
  - Admin moderation tools (Account Isolation, Force Reverification, Profile Verification Badge, Ledger Purge, and Live Telemetry) never appear in normal user views.
  - Personal user actions (`+ New Transaction`) are hidden in Admin Mode.
- **Unified Platform Live View**:
  - High-level KPI cards, real-time telemetry stream (with Pause/Resume, category filters, and JSON packet inspection drawer), User Management, All Ledgers, and System Analytics (`300–850` Average Trust Score) live cleanly inside `/admin` sub-tabs.

---

## 10. UI/UX & Responsive Layout Architecture

All components adhere to the strict responsive standards in [`AGENTS.md`](file:///c:/Users/ssnay/Documents/Github/Debt-Sync/AGENTS.md):
- **Desktop (`md:` ≥ 768px)**:
  - Fixed left `Sidebar.tsx` + `TopBar.tsx`.
  - Compact side-by-side **"Report"** and **"About"** pills in the sidebar footer and profile menu so utility links remain minimal and uncluttered.
- **Mobile (`< 768px`)**:
  - Compact `TopBar.tsx` + 5-item fixed `BottomNav.tsx` with `pb-[env(safe-area-inset-bottom,0px)]`.
  - All `<input>`, `<textarea>`, and `<select>` elements enforce `>= 16px` (`text-base`) on mobile to prevent iOS Safari / Android Chrome auto-zoom on focus.
  - Modals and drawers use `max-h-[92dvh]`, `overscroll-contain`, and `44x44px` minimum touch targets.

---

## 11. Supabase Database Schema & Migrations (`001` – `027`)

All SQL migrations are stored sequentially in `supabase/migrations/`:

| Migration | Purpose |
| :--- | :--- |
| `001_initial_schema.sql` | Core `profiles`, `debts`, `payments`, `contacts`, `activity_log` tables & RLS policies |
| `002` – `004` | Secondary emails, default country codes (`+91`), and duplicate account prevention |
| `005` – `008` | Bilateral debt acceptance workflow, realtime publication, rate limiting, custom avatars |
| `009` – `012` | Privacy controls, verification badges, account deletion, payment disputes & ledger purge |
| `013` – `014` | Admin Observatory controls, UPI/payment methods, user isolation (`is_isolated`) |
| `015` – `017` | Group Split Bills (`split_groups`, `split_participants`), default interest, bank/UPI details |
| `018` – `022` | Auto-connect on accept, anti-spam guards, admin purge tombstones, ghost profile resolution |
| `023` – `026` | Web Push subscriptions, notification preferences, pending debt & due-date reminder RPCs |
| `027_server_dynamic_network_score.sql` | **Server-calibrated dynamic Network Trust Score (`300–850`) RPCs** (`calculate_user_trust_score` & `get_batch_trust_scores`) |

---

## 12. Environment Variables & Deployment Reference

Configure these variables in `.env.local` (for local development) and in your **Cloudflare Pages / Vercel** environment settings:

```env
# 1. Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# 2. Canonical App URL (Required for Auth Callbacks & Share Links)
NEXT_PUBLIC_APP_URL=https://debt-sync.satya-nayak.dev

# 3. Web Push Notifications (Optional - VAPID Public Key)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-public-key

# 4. Server-Only Discord Webhook (Required for Bug Reports & Contact Inquiries)
# IMPORTANT: Never prefix with NEXT_PUBLIC_ so the URL stays hidden from client bundles.
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_BUG_WEBHOOK_URL=https://discord.com/api/webhooks/...

# 5. Transactional Email Fallback (Optional - Resend API)
RESEND_API_KEY=re_...
EMAIL_FROM=DebtSync <notifications@debt-sync.satya-nayak.dev>
```

---

## 13. Key Bug Fixes & Edge-Case Protections

1. **Cross-Device Network Trust Score Parity**: Replaced partial client-only calculations with server-calibrated RPCs (`027_server_dynamic_network_score.sql`) + UTC calendar date math and full payment history fetching in `RecordDebtModal`, `Directory`, `Analytics`, and `Admin`.
2. **Session Cache Isolation**: Prevented `dash/page.tsx` from overwriting `ledgerCache.people` with incomplete contact stubs that lacked `trustScore` and `netBalance`.
3. **Unaccepted (`pending`) Debt Isolation**: Excluded `pending` proposals from active portfolio totals (`totalLent`, `totalOwed`, `netPosition`, `totalOutstandingVolume`) across Dashboard, Directory, Peer Detail, and Admin Observatory until accepted.
4. **Verified-Only Payment Sums**: Excluded unverified and `[DISPUTED]` payments from `totalPaid` in the Peer Detail 3-way breakdown.
5. **Borrower-Created Agreement Acceptance Guard**: Fixed `/accept` so agreements initiated by a borrower (`debt.created_by === debt.borrower_id`) attribute the creator properly and never show `Accept / Decline` buttons to the creator of their own outbound proposal.
6. **React Hooks Invariant**: All components declare React hooks unconditionally at the top level before any early `return` gates, preventing production hydration/render crashes.
