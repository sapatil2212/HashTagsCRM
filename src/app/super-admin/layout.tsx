import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Super Admin — HashTags CRM",
  description: "Super Admin Portal for HashTags CRM",
  robots: { index: false, follow: false },
};

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
