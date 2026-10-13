import type { Metadata } from "next";
import { SuperAdminShell } from "./super-admin-shell";

import { getSiteConfig } from "@/lib/cms/site-config";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const siteName = config.siteName || "Hashtags CRM";
  return {
    title: `Super Admin — ${siteName}`,
    description: `Super Admin Portal for ${siteName}`,
    robots: { index: false, follow: false },
  };
}

// The shell (sidebar + header + auth gate) lives here, in the layout, so it
// mounts once and persists across navigations between the overview, users,
// new-users and settings routes. It previously wrapped each page individually,
// which remounted the whole chrome — and re-ran the auth check and the pending
// poll — on every route change. The shell short-circuits to bare children for
// `/super-admin/login`, so the login route stays full-screen.
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminShell>{children}</SuperAdminShell>;
}
