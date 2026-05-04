import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Script from "next/script";
import { ThemeProvider } from "@/components/ThemeProvider";
import { THEMES, DEFAULT_THEME_ID } from "@/lib/themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SSH Manager",
  description: "Manage your SSH sessions and credential profiles",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SSH Manager",
  },
};

// Pre-hydration script: read theme from localStorage and apply CSS vars
// before React hydrates, to avoid a flash of the wrong theme.
const preHydrationScript = `
(function () {
  try {
    var THEMES = ${JSON.stringify(THEMES)};
    var stored = localStorage.getItem('ssh-manager-theme');
    var id = stored && THEMES.some(function (t) { return t.id === stored; }) ? stored : '${DEFAULT_THEME_ID}';
    var t = THEMES.find(function (x) { return x.id === id; }) || THEMES[0];
    var r = document.documentElement;
    r.style.setProperty('--accent', t.accent);
    r.style.setProperty('--accent-foreground', t.accentForeground);
    r.style.setProperty('--bg', t.bg);
    r.style.setProperty('--fg', t.fg);
    r.style.setProperty('--card', t.card);
    r.style.setProperty('--card-elevated', t.cardElevated);
    r.style.setProperty('--muted-fg', t.mutedFg);
    r.style.setProperty('--subtle-fg', t.subtleFg);
    r.style.setProperty('--border', t.border);
    r.style.setProperty('--muted', t.muted);
    r.style.setProperty('--background', t.bg);
    r.style.setProperty('--foreground', t.fg);
    r.style.setProperty('--card-foreground', t.fg);
    r.style.setProperty('--popover', t.cardElevated);
    r.style.setProperty('--popover-foreground', t.fg);
    r.style.setProperty('--primary', t.accent);
    r.style.setProperty('--primary-foreground', t.accentForeground);
    r.style.setProperty('--muted-foreground', t.mutedFg);
    r.dataset.theme = t.id;
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <head>
        <meta name="theme-color" content="#0d1117" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script dangerouslySetInnerHTML={{ __html: preHydrationScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
          }
        `}</Script>
      </body>
    </html>
  );
}
