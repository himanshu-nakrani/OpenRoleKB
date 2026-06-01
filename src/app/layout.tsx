import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openrolekb.example.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "OpenRoleKB — Natural-language job search",
    template: "%s · OpenRoleKB",
  },
  description:
    "Describe the role you want in plain English. Neural search across real ATS sources, AI-ranked against your exact ask.",
  openGraph: {
    title: "OpenRoleKB — Natural-language job search",
    description: "Neural search · AI ranked · Real ATS sources.",
    url: SITE_URL,
    siteName: "OpenRoleKB",
    images: [{ url: "/api/og", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenRoleKB",
    description: "Neural search · AI ranked · Real ATS sources.",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('openrolekb_theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')})()`,
          }}
        />
      </head>
      <body className="min-h-full bg-bg text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent-dark focus:text-accent-text focus:rounded-full"
        >
          Skip to search
        </a>
        <Providers>
          <AppHeader />
          <main id="main-content" className="flex-1 px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
