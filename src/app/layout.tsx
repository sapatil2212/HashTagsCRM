import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { DEFAULT_THEME, STORAGE_KEY, THEME_IDS } from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

import { getSiteConfig } from "@/lib/cms/site-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const siteName = config.siteName || "Hashtags CRM";
  const title = config.metaTitle || `${siteName} - AI Powered WhatsApp CRM & Automation Platform`;
  const description =
    config.metaDescription ||
    "Manage leads, automate customer communication, and grow your business with our AI-powered WhatsApp CRM platform.";
  const icon = config.faviconUrl || "/favicon.ico";
  const logo = config.logoUrl || "https://hashtagscrm.com/images/logo/chatnexgen-logo.png";

  return {
    title: {
      default: title,
      template: `%s — ${siteName}`,
    },
    description,
    icons: {
      icon,
      shortcut: icon,
      apple: icon,
    },
    openGraph: {
      title,
      description,
      url: process.env.NEXT_PUBLIC_SITE_URL || "https://hashtagscrm.com",
      siteName,
      images: [
        {
          url: config.ogImageUrl || logo,
          width: 1200,
          height: 630,
          alt: `${siteName} Logo`,
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [config.ogImageUrl || logo],
    },
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    robots: {
      index: !config.maintenanceMode,
      follow: !config.maintenanceMode,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
};

// Inline boot script — runs before React hydrates so the user's
// chosen theme is on the <html> element before first paint. Without
// this every page load flashes the default Violet for a frame before
// the React tree mounts and applies the picked theme.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid theme IDs
// is sourced from the THEME_IDS constant so adding a theme doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var STORAGE_KEY = ${JSON.stringify(STORAGE_KEY)};
    var DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var ALLOWED = ${JSON.stringify(THEME_IDS)};
    var saved = localStorage.getItem(STORAGE_KEY);
    var theme = ALLOWED.indexOf(saved) !== -1 ? saved : DEFAULT;
    document.documentElement.dataset.theme = theme;
  } catch (_e) {
    document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
  }
  
  try {
    var savedMtheme = localStorage.getItem("hashtagscrm.mtheme");
    var mtheme = "dark";
    if (savedMtheme === "light" || savedMtheme === "dark") {
      mtheme = savedMtheme;
    }
    // No system preference fallback — dark is always the default
    document.documentElement.setAttribute("data-mtheme", mtheme);
    if (mtheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  } catch (_e) {
    document.documentElement.setAttribute("data-mtheme", "dark");
    document.documentElement.classList.add("dark");
  }
})();
`;


import { SiteConfigProvider } from "@/context/site-config-context";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = await getSiteConfig();
  const siteName = config.siteName || "Hashtags CRM";
  const favicon = config.faviconUrl || "/favicon.ico";

  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      data-mtheme="dark"
      className={`${inter.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Dynamic Favicon */}
        <link rel="icon" href={favicon} />
        <link rel="shortcut icon" href={favicon} />

        {/* Theme boot — runs before first paint to avoid flash. */}
        <script
          id="theme-boot"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
          suppressHydrationWarning
        />

        {/* Dynamic Organization JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": `${siteName} Technologies`,
              "alternateName": siteName,
              "url": process.env.NEXT_PUBLIC_SITE_URL || "https://hashtagscrm.com",
              "logo": config.logoUrl || "https://hashtagscrm.com/images/logo/chatnexgen-logo.png",
              "email": config.contactEmail || "admin@hashtagscrm.com",
              "contactPoint": {
                "@type": "ContactPoint",
                "telephone": config.contactPhone || "+92 316 1122339",
                "contactType": "customer service",
                "email": config.contactEmail || "admin@hashtagscrm.com",
                "areaServed": "Global",
                "availableLanguage": ["en", "ur", "hi"]
              },
              "address": {
                "@type": "PostalAddress",
                "addressLocality": config.contactAddress || "Pune, Maharashtra, India"
              },
              "description": config.metaDescription || "AI-Powered WhatsApp CRM & Business Automation Platform"
            })
          }}
        />

        {/* Super-admin injected analytics if configured */}
        {config.analyticsId && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${config.analyticsId}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${config.analyticsId}');`,
              }}
            />
          </>
        )}

        {/* Super-admin custom <head> HTML snippet */}
        {config.customHeadHtml && (
          <div dangerouslySetInnerHTML={{ __html: config.customHeadHtml }} />
        )}
      </head>
      <body className="min-h-full bg-background text-foreground font-sans" suppressHydrationWarning>
        <ThemeProvider>
          <SiteConfigProvider initialConfig={config}>
            {children}
            <Toaster
              theme="dark"
              position="top-right"
              toastOptions={{
                style: {
                  background: "rgb(30 41 59)",
                  border: "1px solid rgb(51 65 85)",
                  color: "white",
                },
              }}
            />
          </SiteConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
