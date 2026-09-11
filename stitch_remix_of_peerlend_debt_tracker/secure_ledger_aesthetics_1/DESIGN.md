---
name: Secure Ledger Aesthetics
colors:
  surface: '#0A0C10'
  surface-dim: '#111318'
  surface-bright: '#37393e'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#1a1c20'
  surface-container: '#161B22'
  surface-container-high: '#21262D'
  surface-container-highest: '#333539'
  on-surface: '#F0F6FC'
  on-surface-variant: '#8B949E'
  inverse-surface: '#e2e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#849493'
  outline-variant: '#3b4a49'
  surface-tint: '#00dddd'
  primary: '#74ffff'
  on-primary: '#003737'
  primary-container: '#00e5e5'
  on-primary-container: '#006262'
  inverse-primary: '#006a6a'
  secondary: '#4fdad9'
  on-secondary: '#003737'
  secondary-container: '#00b3b3'
  on-secondary-container: '#003e3e'
  tertiary: '#9efaf9'
  on-tertiary: '#003737'
  tertiary-container: '#82dddc'
  on-tertiary-container: '#006262'
  error: '#F85149'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#3ffafa'
  primary-fixed-dim: '#00dddd'
  on-primary-fixed: '#002020'
  on-primary-fixed-variant: '#004f4f'
  secondary-fixed: '#70f6f6'
  secondary-fixed-dim: '#4fdad9'
  on-secondary-fixed: '#002020'
  on-secondary-fixed-variant: '#004f50'
  tertiary-fixed: '#97f2f1'
  tertiary-fixed-dim: '#7ad5d5'
  on-tertiary-fixed: '#002020'
  on-tertiary-fixed-variant: '#004f4f'
  background: '#111318'
  on-background: '#e2e2e8'
  surface-variant: '#333539'
  success: '#3FB950'
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
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 20px
---

## Brand & Style

The design system maintains a personality of **Trust, Precision, and Security**, now reimagined for a high-performance dark environment. The shift to a dark interface reinforces a sense of "command center" authority and modern financial sophistication.

The design style is **Corporate Modern with a Minimalist focus**. By utilizing a deep charcoal canvas, we reduce eye strain and allow critical financial data to "pop" with vibrant teal accents. The aesthetic is clean, technical, and high-contrast, designed to evoke the feeling of a secure vault or a professional trading terminal. The UI avoids unnecessary ornamentation, favoring geometric clarity and deliberate information density to provide users with a sense of total control over their data.

## Colors

The color palette is optimized for maximum legibility in low-light environments, using a **Deep Charcoal and Vibrant Cyan** scheme.

- **Primary Cyan (#00E5E5):** A high-chroma, vibrant teal used for primary actions, active states, and critical brand moments. It provides a sharp "neon" contrast against the dark background to ensure instant recognition.
- **Secondary & Tertiary (#14B8B8, #007A7A):** Muted variations of the primary hue used for tiered information hierarchy, such as distinguishing between lender/borrower data or secondary UI elements.
- **Surface Palette:** The background uses a near-black charcoal (`#0A0C10`). Elevated containers use progressively lighter shades of gray-blue (`#161B22`, `#21262D`) to create depth without relying on shadows.
- **Typography:** Primary text is off-white (`#F0F6FC`) for high contrast, while secondary metadata uses a medium-gray (`#8B949E`) to reduce visual noise.

## Typography

This design system leverages **Hanken Grotesk** for its primary messaging, offering a clean, geometric feel that matches the technical precision of the brand. 

For financial data, the system switches to **JetBrains Mono**. This monospaced choice ensures that numerical values align perfectly in columns, which is essential for audit logs and balance comparisons.

**Typographic Principles:**
- **Alignment:** Use `numeric-ticker` for all primary currency displays to ensure vertical alignment of decimals.
- **Emphasis:** Use `label-mono` in uppercase for all-caps metadata tags and table headers.
- **Hierarchy:** Balance displays must use `headline-xl` to stand out against the dark canvas.

## Layout & Spacing

The system follows a **12-column fluid grid** for desktop environments, ensuring that data-heavy dashboards utilize the full width of the display.

**Layout Model:**
- **Navigation:** A fixed 240px side navigation rail provides a constant anchor for the user, while mobile views collapse this into a streamlined bottom navigation bar.
- **Spacing Rhythm:** Based on a 4px scale. The standard container padding is 24px (`md`), while tighter groupings within cards use 16px (`sm`).
- **Responsive Reflow:** On mobile devices, the 12-column grid collapses to 4 columns. All balance cards and debt items reflow to a single-column vertical stack for thumb-friendly interaction.

## Elevation & Depth

In dark mode, depth is conveyed through **Tonal Layering** rather than traditional shadows. This maintains the "Secure" and "Professional" flat aesthetic while ensuring visual hierarchy.

- **Background:** The deepest layer (`#0A0C10`) serves as the global canvas.
- **Containers:** Interactive cards and sidebars use a lighter surface (`#161B22`).
- **Overlays:** Modals and menus use the highest surface tier (`#21262D`) with a subtle 1px border (`#30363D`) to define the edge against the background.
- **Active States:** Subtle glow effects (10% opacity of the Primary Cyan) can be applied to focused inputs or active buttons to simulate a functional light source.

## Shapes

The design system utilizes **Rounded (Level 2)** shapes to soften the technical nature of the data without appearing overly casual. 

- **Base Radius:** 0.5rem (8px) is applied to all primary cards, action buttons, and input fields.
- **Small Elements:** Tooltips and checkboxes use a reduced 0.25rem (4px) radius.
- **Pills:** Full roundedness (9999px) is reserved strictly for status indicators (e.g., "Paid", "Overdue") to distinguish them from functional buttons.

## Components

### Buttons
- **Primary:** Solid `#00E5E5` with `#0A0C10` text. High contrast for immediate visibility.
- **Secondary:** Ghost style with `#00E5E5` border and text. Focus state adds a 10% opacity teal fill.

### Input Fields
- **Default:** Dark background (`#0D1117`) with a 1px border (`#30363D`).
- **Focus:** Border changes to `#00E5E5` with a subtle outer glow of the same color.

### Cards & Lists
- **Balance Card:** Features a `#161B22` background with a 1px border. The primary currency value uses the `numeric-ticker` style.
- **Audit Log:** Each row uses a thin horizontal separator (`#21262D`). The `label-mono` timestamp should be in the secondary text color (`#8B949E`).

### Chips
- **Status Chips:** Pill-shaped. Success uses a dark green background with light green text; Error uses a dark red background with light red text. Avoid pure white text on chips to maintain the dark-mode aesthetic.

### Data Visualization
- **Progress Bars:** Use a "track" of `#21262D` and a "fill" of Primary Cyan. For multi-part bars, use the Secondary and Tertiary teals to differentiate segments.