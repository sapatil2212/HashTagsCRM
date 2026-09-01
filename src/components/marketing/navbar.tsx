"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChevronDown, Menu, X, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";
import { ThemeToggle } from "./theme-toggle";
import { MagneticButton } from "./magnetic-button";
import { BookDemoTrigger } from "./book-demo-trigger";
import { cn } from "@/lib/utils";

export function GlassNavbar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { resolvedTheme } = useMarketingTheme();
  const isLight = resolvedTheme === "light";
  const supabase = createClient();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsLoggedIn(!!session);
    };
    checkUser();

    const onScroll = () => {
      const scrollY = window.scrollY;
      if (scrollY > 20) {
        setIsScrolled(true);
      } else if (scrollY < 10) {
        setIsScrolled(false);
      }
    };

    // Initial check
    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });

    const onClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [supabase]);

  const navLinks = [
    { name: "Home", href: "/" },
    { name: "Features", href: "/features" },
    { name: "AI Automation", href: "/ai-automation" },
    { name: "Pricing", href: "/pricing" },
  ];

  const dropdownLinks = [
    { name: "Shared Inbox", href: "/shared-team-inbox" },
    { name: "CRM Engine", href: "/crm" },
    { name: "Analytics Dashboard", href: "/analytics" },
    { name: "Enterprise SaaS", href: "/enterprise" },
    { name: "Security & GDPR", href: "/security" },
    { name: "Customer Stories", href: "/customer-stories" },
    { name: "About Us", href: "/about-us" },
    { name: "Careers", href: "/careers" },
    { name: "Blog Hacks", href: "/blog" },
  ];

  const pillStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: isScrolled ? "920px" : "1152px",
    borderRadius: isScrolled ? "9999px" : "14px",
    padding: isScrolled ? "8px 22px" : "6px 12px",
    backgroundColor: isScrolled
      ? (isLight ? "rgba(255, 255, 255, 0.92)" : "rgba(2, 6, 23, 0.85)")
      : "transparent",
    border: isScrolled
      ? (isLight ? "1px solid rgba(203, 213, 225, 0.65)" : "1px solid rgba(30, 41, 59, 0.55)")
      : "1px solid transparent",
    boxShadow: isScrolled
      ? (isLight ? "0 4px 28px rgba(0, 0, 0, 0.07)" : "0 4px 28px rgba(0, 0, 0, 0.50)")
      : "0 0 0 transparent",
    backdropFilter: isScrolled ? "blur(20px)" : "blur(0px)",
    WebkitBackdropFilter: isScrolled ? "blur(20px)" : "blur(0px)",
    transition: "max-width 0.45s cubic-bezier(0.16, 1, 0.3, 1), padding 0.45s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.45s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease, backdrop-filter 0.4s ease, -webkit-backdrop-filter 0.4s ease",
    willChange: "max-width, padding, border-radius, background-color, border-color, box-shadow",
  };

  const linkCls = "text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)]";

  return (
    <>
      <header
        className="fixed inset-x-0 z-50 flex justify-center pointer-events-none px-4 sm:px-6 transition-[top] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ top: isScrolled ? "12px" : "16px" }}
      >
        <div
          className="pointer-events-auto flex items-center justify-between"
          style={pillStyle}
        >
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <img
              src={isLight ? "/images/logo/chatnexgen-logo-light.png" : "/images/logo/chatnexgen-logo.png"}
              alt="Hashtags CRM Logo"
              className="h-10 md:h-11 w-auto object-contain group-hover:scale-110 transition-transform"
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-[11px] font-semibold tracking-wide transition-colors duration-200 whitespace-nowrap",
                  pathname === link.href ? "text-orange-500 font-bold" : linkCls
                )}
              >
                {link.name}
              </Link>
            ))}
          </nav>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            <BookDemoTrigger
              className={cn("text-[11px] font-semibold transition-colors px-3 py-1.5 whitespace-nowrap cursor-pointer", linkCls)}
            >
              Book Demo
            </BookDemoTrigger>
            <MagneticButton>
              <Link
                href={isLoggedIn ? "/dashboard" : "/login"}
                className="text-[11px] font-bold bg-orange-500 hover:bg-orange-400 text-white px-4 py-1.5 rounded-full transition-all shadow-[0_2px_12px_rgba(255,165,0,0.3)] whitespace-nowrap"
              >
                {isLoggedIn ? "Dashboard" : "Sign In"}
              </Link>
            </MagneticButton>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setIsOpen((v) => !v)}
            className="md:hidden w-8 h-8 rounded-full border flex items-center justify-center transition-colors bg-[var(--m-bg-secondary)] border-[var(--m-border-primary)] text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)]"
          >
            {isOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {isOpen && (
        <div className="fixed inset-0 top-[68px] z-40 p-6 flex flex-col justify-between md:hidden bg-[var(--m-bg-secondary)] border-t border-[var(--m-border-primary)] backdrop-blur-xl">
          <div className="space-y-6">
            <div className="flex flex-col gap-4">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)]">
                Navigation
              </span>
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="text-sm font-bold transition-colors text-[var(--m-text-primary)] hover:text-orange-500"
                >
                  {link.name}
                </Link>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)]">
                Solutions
              </span>
              <div className="grid grid-cols-2 gap-3">
                {dropdownLinks.slice(0, 6).map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className="text-xs font-semibold transition-colors text-[var(--m-text-secondary)] hover:text-orange-500"
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 mt-8">
            <div className="flex justify-center py-1">
              <ThemeToggle className="w-full justify-around" />
            </div>
            <BookDemoTrigger className="w-full text-center text-xs font-bold py-3 rounded-full border transition-colors border-[var(--m-border-primary)] bg-[var(--m-bg-tertiary)] text-[var(--m-text-primary)]">
              Book Demo
            </BookDemoTrigger>
            <Link
              href={isLoggedIn ? "/dashboard" : "/login"}
              onClick={() => setIsOpen(false)}
              className="w-full text-center text-xs font-bold bg-orange-500 text-white py-3 rounded-full hover:bg-orange-400 transition-colors shadow-[0_2px_12px_rgba(255,165,0,0.3)]"
            >
              {isLoggedIn ? "Dashboard" : "Sign In"}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
