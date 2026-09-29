<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DebtSync UI Architecture & Responsiveness Guidelines

All coding agents working on DebtSync MUST adhere strictly to the dual-format UI layout conventions for desktop and mobile (phone) viewports. Under no circumstances should desktop and mobile patterns conflict or degrade user experience.

---

## 1. Desktop vs. Mobile Layout Separation

### Desktop (`md:` breakpoint and above - ≥ 768px)
- **Navigation Architecture**:
  - Uses the fixed left sidebar (`src/components/layout/Sidebar.tsx`) and top header (`src/components/layout/TopBar.tsx`).
  - **No In-Page Redundancy**: Never duplicate in-page horizontal tabs into the left sidebar. For example, in Admin Observatory, page-level sub-tabs (`Platform Live View`, `Users`, `All Ledgers`, `System Analytics`) live exclusively on the page. The desktop sidebar must remain clean, featuring only primary destinations (`Admin Hub`, `Settings`), the superuser status card, and the view mode switcher.
  - **Strict Active Route Matching**: Navigation items must match routes unambiguously. Avoid broad prefix matches like `item.href.startsWith('/admin')` that cause multiple tabs to highlight simultaneously. Ensure exact route or query-aware checks (`pathname === item.href`).

### Mobile (Phone viewports - < 768px)
- **Navigation Architecture**:
  - Uses `TopBar.tsx` (compact brand header + notifications + avatar menu) and `BottomNav.tsx` (5-item fixed bottom navigation with center action button).
  - **Query & Tab Synchronization**: When bottom navigation links to page tabs (e.g. `/admin?tab=overview`, `/admin?tab=users`, `/admin?tab=transactions`), synchronize the active indicator using URL search parameters and custom events (`debtsync:admin_tab_changed`). Only the single matching tab may be highlighted at any time.
- **Touch & Mobile Viewport Constraints**:
  - **Safe-Area Insets**: Always include safe area padding: `pb-[env(safe-area-inset-bottom,0px)]` on bottom navbars and sticky footers.
  - **Input Auto-Zoom Prevention**: All text inputs (`<input>`, `<textarea>`, `<select>`) must have an effective font size of at least `16px` on mobile (`text-base` or custom CSS) to prevent mobile Safari/Chrome from triggering automatic page zoom-in.
  - **Responsive Modals & Drawers**:
    - Use dynamic viewport heights: `max-h-[92dvh]` or `h-[92dvh]`.
    - Apply `overscroll-contain` on scrollable modal bodies to prevent background page scroll-chaining.
    - Ensure close buttons and primary actions are touch-friendly (minimum `44x44px` touch target).
  - **Pinch-to-Zoom**: Keep viewport metadata accessible (`maximumScale: 5`, `userScalable: true`) while designing layout containers so they never clip or break when users zoom.

---

## 2. Admin vs. User Mode Integrity

- **Strict Privilege Partitioning**:
  - Admin view mode (`viewMode === 'admin'`) and normal user mode (`viewMode === 'user'`) must remain completely distinct.
  - Admin moderation controls (isolation, purge, force reverification, admin verification) and telemetry feeds must never leak into regular user pages or client profiles.
  - User actions that make no sense in admin mode (such as "+ New Transaction" or personal debt balances) must be omitted or replaced with administrative actions in Admin View.
  - Switching between views must be instantaneous via `debtsync:view_mode_changed` events and `localStorage`.

---

## 3. Unified Live Telemetry & Information Density

- **Consolidated Live Stream**:
  - Keep high-level KPI cards and real-time live telemetry feeds unified on the primary platform overview (`Platform Live View`), avoiding fragmented navigation between static overviews and live feeds.
  - Provide stream controls (Pause/Resume, category filtering, clear buffer) and allow admins to inspect payload JSON packets in a non-disruptive drawer or modal.

---

## 4. Quality & Build Verification Rule

- Every change touching layouts, navigation, or styles must be verified with:
  ```bash
  npm run build
  ```
- Must always compile cleanly with **0 TypeScript errors** and **0 Next.js build warnings/errors** before completing any task.
