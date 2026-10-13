import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/cms/site-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const siteName = config.siteName || "Hashtags CRM";
  return {
    title: `Super Admin — ${siteName}`,
    robots: { index: false, follow: false },
  };
}

export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
