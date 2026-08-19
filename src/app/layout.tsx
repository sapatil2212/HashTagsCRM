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

export const metadata: Metadata = {
  title: {
    default: "HashTags CRM - AI Powered WhatsApp CRM & Automation Platform",
    template: "%s — HashTags CRM",
  },
  description: "Manage leads, automate customer communication, and grow your business with HashTags CRM's AI-powered WhatsApp CRM platform.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "HashTags CRM - AI Powered WhatsApp CRM & Automation Platform",
    description: "Manage leads, automate customer communication, and grow your business with HashTags CRM's AI-powered WhatsApp CRM platform.",
    url: "https://hashtagscrm.com",
    siteName: "HashTags CRM",
    images: [
      {
        url: "https://hashtagscrm.com/images/logo/chatnexgen-logo.png",
        width: 1200,
        height: 630,
        alt: "HashTags CRM Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HashTags CRM - AI Powered WhatsApp CRM & Automation Platform",
    description: "Manage leads, automate customer communication, and grow your business with HashTags CRM's AI-powered WhatsApp CRM platform.",
    images: ["https://hashtagscrm.com/images/logo/chatnexgen-logo.png"],
  },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

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


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      data-mtheme="dark"
      className={`${inter.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Theme boot — runs before first paint to avoid flash.
            Rendered as a raw script element in the server HTML;
            React never re-executes it on the client. */}
        <script
          id="theme-boot"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
          suppressHydrationWarning
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "HashTags CRM Technologies",
              "alternateName": "HashTags CRM",
              "url": "https://hashtagscrm.com",
              "logo": "https://hashtagscrm.com/images/logo/chatnexgen-logo.png",
              "email": "admin@hashtagscrm.com",
              "contactPoint": {
                "@type": "ContactPoint",
                "telephone": "+92 316 1122339",
                "contactType": "customer service",
                "email": "admin@hashtagscrm.com",
                "areaServed": "Global",
                "availableLanguage": ["en", "ur", "hi"]
              },
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Pune",
                "addressRegion": "Maharashtra",
                "addressCountry": "India"
              },
              "description": "AI-Powered WhatsApp CRM & Business Automation Platform helping businesses manage leads and automate customer support."
            })
          }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans" suppressHydrationWarning>
        <ThemeProvider>
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
        </ThemeProvider>
      </body>
    </html>
  );
}
