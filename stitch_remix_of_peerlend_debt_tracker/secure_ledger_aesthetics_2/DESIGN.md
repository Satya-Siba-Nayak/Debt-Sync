---
name: Secure Ledger Aesthetics
colors:
  surface: '#f8f9ff'
  surface-dim: '#d1daeb'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#e0e9f9'
  surface-container-highest: '#dae3f4'
  on-surface: '#131c28'
  on-surface-variant: '#3f484a'
  inverse-surface: '#28313d'
  inverse-on-surface: '#eaf1ff'
  outline: '#6f797a'
  outline-variant: '#bfc8c9'
  surface-tint: '#20686f'
  primary: '#004349'
  on-primary: '#ffffff'
  primary-container: '#0d5c63'
  on-primary-container: '#90d2da'
  inverse-primary: '#8fd1d9'
  secondary: '#006a69'
  on-secondary: '#ffffff'
  secondary-container: '#95efed'
  on-secondary-container: '#006e6e'
  tertiary: '#004349'
  on-tertiary: '#ffffff'
  tertiary-container: '#005c64'
  on-tertiary-container: '#7fd4de'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#abeef6'
  primary-fixed-dim: '#8fd1d9'
  on-primary-fixed: '#002023'
  on-primary-fixed-variant: '#004f55'
  secondary-fixed: '#98f2f0'
  secondary-fixed-dim: '#7bd5d4'
  on-secondary-fixed: '#002020'
  on-secondary-fixed-variant: '#00504f'
  tertiary-fixed: '#9bf0fa'
  tertiary-fixed-dim: '#7fd4de'
  on-tertiary-fixed: '#001f23'
  on-tertiary-fixed-variant: '#004f56'
  background: '#f8f9ff'
  on-background: '#131c28'
  surface-variant: '#dae3f4'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  numeric-ticker:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 20px
  container-max: 1200px
---

## Brand & Style

The visual identity of the design system is anchored in **Trust, Transparency, and Precision**. Given the sensitive nature of peer-to-peer debt tracking, the UI must feel authoritative yet accessible.

We adopt a **Corporate Modern** style with a focus on data density and clarity. The aesthetic balances the reliability of traditional banking with the agility of a modern SaaS platform. We utilize generous whitespace to prevent information overload, paired with sharp, high-contrast data visualizations that provide immediate "at-a-glance" status updates. The mood is calm and professional, aimed at reducing the social friction often associated with personal debt.

## Colors

The palette uses a range of **Deep Teals and Professional Blues** to establish security. 
- **Primary Teal (#0D5C63):** Used for primary actions, navigation headers, and key brand moments. It conveys stability.
- **Secondary & Tertiary (#44A1A0, #78CDD7):** Used for data visualization layers (e.g., progress bar segments) and subtle UI backgrounds to differentiate between "Lender" and "Borrower" views.
- **Status Accents:** We use a high-chroma Green for repayments/success and a muted Brick Red for overdue balances or alerts. These are used sparingly to maintain a calm environment.
- **Neutrals:** A very dark navy-charcoal is used for text to ensure maximum readability against the soft-white and light-gray backgrounds.

## Typography

We use **Hanken Grotesk** as the primary typeface for its sharp, contemporary geometry and exceptional legibility in financial tables. Its "tech-forward" feel aligns with the modern peer-to-peer nature of the platform.

For financial figures, transaction IDs, and the live accrual ticker, we utilize **JetBrains Mono**. The monospaced nature of this font ensures that numbers align perfectly in columns, preventing horizontal "jitter" when values update in real-time. 

**Hierarchy Rules:**
- Use `headline-xl` only for main dashboard balances.
- Use `label-mono` (all-caps) for table headers and small metadata tags.
- All currency values should use the monospaced weight to maintain vertical alignment in lists.

## Layout & Spacing

The design system employs a **12-column fluid grid** for desktop and a **4-column grid** for mobile. 

**Layout Model:**
- **Dashboard View:** Features a fixed left-hand navigation rail (240px) on desktop, transitioning to a bottom navigation bar on mobile.
- **Spacing Rhythm:** We use a base-4 spacing scale. 24px (`md`) is the standard padding for container cards, while 16px (`sm`) is used for internal element grouping.
- **Reflow Rules:** On mobile, balance cards span the full width of the screen. In desktop view, these cards are arranged in a masonry or grid layout to allow for side-by-side comparison of different debt streams.

## Elevation & Depth

To maintain a secure and "flat" professional feel, this design system avoids heavy shadows. Instead, we use **Tonal Layers** and **Low-Contrast Outlines**.

- **Level 0 (Background):** Pure white or `#F8FAFB`.
- **Level 1 (Cards):** White surfaces with a 1px border of `rgba(27, 36, 48, 0.08)`. No shadow.
- **Level 2 (Active/Hover):** A very soft, ambient shadow (0px 4px 12px rgba(0,0,0,0.04)) is applied only to interactive elements like buttons or expanded list items.
- **Depth through Color:** Sub-sections or sidebars use a subtle tint of the primary color (e.g., 5% opacity teal) to differentiate from the primary canvas.

## Shapes

The shape language is **Soft**. We use a 0.25rem (4px) base radius for small elements like checkboxes and input fields. Larger containers like "Balance Cards" and "Action Buttons" use 0.5rem (8px). 

This subtle rounding strikes a balance: it’s friendlier than sharp 90-degree corners (which can feel harsh or overly technical) but maintains the structural integrity and seriousness required for a financial tool. **Pill-shaped (fully rounded) elements are reserved exclusively for status "Chips"** (e.g., "Paid", "Pending").

## Components

### Data Visualization
- **Live Ticker:** Uses `numeric-ticker` typography. The decimal points of the accrual should be a slightly lower opacity than the whole numbers to emphasize the primary value.
- **Progress Bars:** Two-tone bars using Primary and Tertiary colors. Use a "ghost" background track in light gray.

### Cards
- **Balance Card:** High-contrast header using the Primary Teal. The main balance should be centered with a secondary label below it.
- **Debt Item Card:** Features a "Split Bar" at the bottom showing Principal vs. Interest visually.

### Inputs & Buttons
- **Primary Button:** Solid Primary Teal with white text. 8px corner radius.
- **Input Fields:** Uses a 1px stroke. Focus state should change the stroke to Primary Teal with a 2px outer "glow" in 10% opacity Teal.
- **Chips:** Small, pill-shaped tags. Success = Green background/white text; Overdue = Red background/white text.

### Lists
- **Audit Log:** Uses a "stepper" style layout with a vertical line connecting timeline dots. Each entry should lead with a `label-mono` timestamp.