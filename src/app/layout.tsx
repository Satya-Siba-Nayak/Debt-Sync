import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeInitializer } from "@/components/ui/ThemeInitializer";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "DebtSync — Trust & Precision",
  description: "Smart peer-to-peer ledger, interest engine, and debt management portal",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DebtSync",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="w-full max-w-full overflow-x-hidden" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="DebtSync" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = null;
                  // 1. Try reading from localStorage safely
                  try {
                    theme = localStorage.getItem('debtsync_theme_v2') || localStorage.getItem('debtsync_theme');
                  } catch (e) {}

                  // 2. Fallback to reading from document.cookie safely
                  if (!theme) {
                    try {
                      var cookies = document.cookie.split(';');
                      for (var i = 0; i < cookies.length; i++) {
                        var c = cookies[i].trim();
                        if (c.indexOf('debtsync_theme_v2=') === 0) {
                          theme = decodeURIComponent(c.substring(18));
                          break;
                        } else if (c.indexOf('debtsync_theme=') === 0 && !theme) {
                          theme = decodeURIComponent(c.substring(15));
                        }
                      }
                    } catch (e) {}
                  }

                  // 3. Resolve whether dark mode should be applied
                  var isDark = false;
                  if (theme === 'dark') {
                    isDark = true;
                  } else if (theme === 'light') {
                    isDark = false;
                  } else {
                    // 'system' or default / no preference: ALWAYS scan system OS theme
                    try {
                      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                    } catch (e) {
                      isDark = false;
                    }
                  }

                  var root = document.documentElement;
                  if (isDark) {
                    root.classList.add('dark');
                    root.setAttribute('data-theme', 'dark');
                    root.style.colorScheme = 'dark';
                  } else {
                    root.classList.remove('dark');
                    root.setAttribute('data-theme', 'light');
                    root.style.colorScheme = 'light';
                  }

                  // Protect against React 19 hydration attribute stripping
                  if (window.MutationObserver) {
                    var observer = new MutationObserver(function() {
                      if (isDark) {
                        if (!root.classList.contains('dark')) root.classList.add('dark');
                        if (root.getAttribute('data-theme') !== 'dark') root.setAttribute('data-theme', 'dark');
                      } else {
                        if (root.classList.contains('dark')) root.classList.remove('dark');
                        if (root.getAttribute('data-theme') !== 'light') root.setAttribute('data-theme', 'light');
                      }
                    });
                    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
                    window.__debtsync_theme_observer = observer;
                    setTimeout(function() {
                      observer.disconnect();
                      if (window.__debtsync_theme_observer === observer) {
                        window.__debtsync_theme_observer = null;
                      }
                    }, 3500);
                  }
                } catch (_) {}

                if ('serviceWorker' in navigator) {
                  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    navigator.serviceWorker.getRegistrations().then(function(regs) {
                      for (var i = 0; i < regs.length; i++) regs[i].unregister();
                    });
                  } else {
                    window.addEventListener('load', function() {
                      navigator.serviceWorker.register('/sw.js').then(
                        function(reg) { /* PWA SW registered */ },
                        function(err) { /* SW registration failed */ }
                      );
                    });
                  }
                }
              })();
            `,
          }}
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
      </head>
      <body className="min-h-[100dvh] bg-[var(--surface)] text-[var(--on-surface)] antialiased w-full max-w-full overflow-x-hidden">
        <ThemeInitializer />
        {children}
      </body>
    </html>
  );
}
