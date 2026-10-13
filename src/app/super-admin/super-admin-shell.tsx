"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Users, BarChart2, Settings, LogOut,
  Menu, X, ChevronRight, Building2, Loader2, UserPlus, Globe
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSiteConfig } from "@/context/site-config-context";

const NAV = [
  { href: "/super-admin",           label: "Overview",   icon: BarChart2 },
  { href: "/super-admin/new-users", label: "New Users",  icon: UserPlus  },
  { href: "/super-admin/users",     label: "Users",      icon: Users     },
  { href: "/super-admin/cms",       label: "CMS",        icon: Globe     },
  { href: "/super-admin/settings",  label: "Settings",   icon: Settings  },
];

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { config } = useSiteConfig();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await fetch("/api/super-admin/users");
        if (res.ok) {
          const data = await res.json();
          const pending = data.users?.filter((u: any) => u.isEmailVerified && !u.isVerified) || [];
          setPendingCount(pending.length);
        }
      } catch (err) {
        console.error("Error fetching pending count:", err);
      }
    };
    fetchPending();
    const interval = setInterval(fetchPending, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/super-admin/auth", { method: "DELETE" });
    router.push("/super-admin/login");
  };

  return (
    <>
      {/* Mobile backdrop */}
      <button
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-900/15 backdrop-blur-[2.5px] lg:hidden transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-slate-200 transition-transform duration-200",
        "bg-white",
        open ? "translate-x-0" : "-translate-x-full",
        "lg:static lg:translate-x-0 lg:z-0"
      )}>
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
          <Link href="/super-admin" onClick={onClose} className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={config.logoUrl || "/images/logo/chatnexgen-logo-light.png"}
              alt={config.siteName}
              className="h-9 w-auto object-contain"
            />
          </Link>
          <span className="rounded-md border border-violet-100 bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-600">
            Admin
          </span>
          <button onClick={onClose} className="ml-auto lg:hidden text-slate-400 hover:text-slate-600 transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const isActive = item.href === "/super-admin"
              ? pathname === "/super-admin"
              : pathname.startsWith(item.href);
            const isNewUsers = item.href === "/super-admin/new-users";
            return (
              <Link key={item.href} href={item.href} onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all",
                  isActive
                    ? "bg-violet-50 text-violet-700 border border-violet-100 font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent"
                )}
              >
                <item.icon className={cn("size-3.5 shrink-0", isActive ? "text-violet-600" : "text-slate-400")} />
                <span className="flex-1">{item.label}</span>
                {isNewUsers && pendingCount > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )}
                {isActive && !isNewUsers && <ChevronRight className="size-3 text-violet-400" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-200 p-3 bg-slate-50/50">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 border border-transparent hover:border-red-100/60 active:scale-[0.98] transition-all"
          >
            <LogOut className="size-3.5" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checking,    setChecking]    = useState(true);
  const pathname = usePathname();
  const router   = useRouter();
  const { config } = useSiteConfig();

  // Enforce light mode strictly in the Super Admin portal
  useEffect(() => {
    document.documentElement.setAttribute("data-mtheme", "light");
    document.documentElement.classList.remove("dark");
    try {
      localStorage.setItem("theme", "light");
    } catch {}
  }, [pathname]);

  const currentLabel =
    [...NAV]
      .sort((a, b) => b.href.length - a.href.length)
      .find((n) => (n.href === "/super-admin" ? pathname === "/super-admin" : pathname.startsWith(n.href)))
      ?.label ?? "Overview";

  const checkAuth = useCallback(async () => {
    if (pathname === "/super-admin/login") {
      setChecking(false);
      return;
    }
    try {
      const res = await fetch("/api/super-admin/auth");
      if (!res.ok) {
        router.replace("/super-admin/login");
      }
    } catch {
      router.replace("/super-admin/login");
    } finally {
      setChecking(false);
    }
  }, [pathname, router]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  if (pathname === "/super-admin/login") return <>{children}</>;

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="size-6 text-violet-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-800">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            >
              <Menu className="size-4" />
            </button>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Building2 className="size-3" />
              <span>{config.siteName}</span>
              <ChevronRight className="size-2.5" />
              <span className="text-slate-700 font-semibold">
                {currentLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-100">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
              <span className="text-[11px] text-violet-700 font-semibold">Super Admin</span>
            </div>
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white text-[10px] font-bold border border-violet-700">
              SA
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
