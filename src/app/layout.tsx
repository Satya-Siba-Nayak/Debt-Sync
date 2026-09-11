import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#006a67",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "DebtSync — Trust & Precision",
  description: "Smart peer-to-peer ledger, interest engine, and debt management portal",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="DebtSync" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = null;
                  // 1. Try reading from localStorage safely
                  try {
                    theme = localStorage.getItem('debtsync_theme');
                  } catch (e) {}

                  // 2. Fallback to reading from document.cookie
                  if (!theme) {
                    try {
                      var match = document.cookie.match(/(?:^|;\\s*)debtsync_theme=([^;]+)/);
                      if (match) theme = decodeURIComponent(match[1]);
                    } catch (e) {}
                  }

                  // 3. Resolve whether dark mode should be applied
                  var isDark = false;
                  if (theme === 'dark') {
                    isDark = true;
                  } else if (theme === 'light') {
                    isDark = false;
                  } else {
                    // 'system' or not set: check system preference
                    try {
                      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                    } catch (e) {
                      isDark = false;
                    }
                  }

                  if (isDark) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (_) {}

                if ('serviceWorker' in navigator) {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js').then(
                      function(reg) { /* PWA SW registered */ },
                      function(err) { /* SW registration failed */ }
                    );
                  });
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
      <body className="min-h-screen bg-[var(--surface)] text-[var(--on-surface)] antialiased">
        {children}
      </body>
    </html>
  );
}
