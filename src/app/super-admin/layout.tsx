import type { Metadata } from "next";
import { SuperAdminShell } from "./super-admin-shell";

export const metadata: Metadata = {
  title: "Super Admin — Hashtags CRM",
  description: "Super Admin Portal for Hashtags CRM",
  robots: { index: false, follow: false },
};

// The shell (sidebar + header + auth gate) lives here, in the layout, so it
// mounts once and persists across navigations between the overview, users,
// new-users and settings routes. It previously wrapped each page individually,
// which remounted the whole chrome — and re-ran the auth check and the pending
// poll — on every route change. The shell short-circuits to bare children for
// `/super-admin/login`, so the login route stays full-screen.
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <SuperAdminShell>{children}</SuperAdminShell>;
}
