"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, Loader2, Eye, EyeOff, CreditCard } from "lucide-react";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";

// ─── LoginPage Component ──────────────────────────────────────────────────────
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/inbox";
  const isVerified = searchParams.get("verified") === "true";
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set when the password was correct but the account needs paying for. Holds
  // the URL to send them to, supplied by the API so the routing rule lives in
  // one place rather than being re-derived from an error string here.
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  // If already logged in, redirect away immediately
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          if (data?.authenticated && data?.user) {
            router.replace(redirectTo);
            return;
          }
        }
      } catch {
        // Not authenticated — stay on login page
      } finally {
        setAuthChecking(false);
      }
    }
    checkExistingSession();
  }, [router, redirectTo]);

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
        <Loader2 className="size-6 animate-spin text-orange-500" />
      </div>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Try MySQL-backed JWT authentication first
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      // A successful login returns the user object and has already set the auth
      // cookies. A full navigation rather than a client-side push, so the proxy
      // re-runs and sees the new cookies.
      if (res.ok && data.user) {
        window.location.href = redirectTo;
        return;
      }

      // 402 Payment Required: the password was correct, but the workspace needs
      // a subscription — either it was never paid for or the period lapsed. The
      // API has already issued a short-lived checkout grant cookie, so the
      // billing page is reachable without a session.
      if (res.status === 402 && typeof data.redirectTo === "string") {
        setCheckoutUrl(data.redirectTo);
        setError(data.message ?? "This workspace needs an active subscription.");
        setLoading(false);
        return;
      }

      if (data.message || data.error) {
        setError(data.message ?? data.error);
        setLoading(false);
        return;
      }

      // 2. Fallback to Supabase auth for legacy accounts
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      router.replace(redirectTo);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred. Please try again.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[var(--m-bg-primary)] px-4 overflow-hidden select-none">
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <div className="absolute top-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-orange-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[20%] w-[50%] h-[50%] rounded-full bg-amber-500/5 blur-[120px] pointer-events-none" />

      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--m-text-tertiary)] hover:text-[var(--m-text-primary)] transition-colors bg-[var(--m-bg-secondary)]/60 border border-[var(--m-border-glass)] px-3 py-1.5 rounded-lg backdrop-blur"
      >
        <ArrowLeft className="size-3.5" /> Back Home
      </Link>

      <Card className="w-full max-w-sm border border-[var(--m-border-glass)]/40 bg-[var(--m-bg-glass)]/70 backdrop-blur-xl relative z-10 p-6 md:p-8 shadow-none transition-all duration-300">
        <CardHeader className="items-center text-center p-0 pb-5">
          <CardTitle className="text-lg font-bold tracking-tight text-[var(--m-text-heading)]">
            Sign In
          </CardTitle>
          <CardDescription className="text-[11px] text-[var(--m-text-tertiary)] mt-1">
            Access your AI WhatsApp Automation Dashboard
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <form onSubmit={handleLogin} className="flex flex-col gap-3.5">
            {isVerified && (
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-[11px] text-orange-400 text-center font-medium">
                Email verified successfully! You can now sign in.
              </div>
            )}
            {errorParam && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400 text-center">
                {errorParam === "invalid-verification-token"
                  ? "Invalid or expired verification link."
                  : "Email verification failed."}
              </div>
            )}
            {error && (
              <div
                className={
                  checkoutUrl
                    ? "rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-[11px] text-orange-400 text-center leading-relaxed"
                    : "rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400 text-center leading-relaxed"
                }
                role={checkoutUrl ? "status" : "alert"}
              >
                {error}
                {checkoutUrl && (
                  <Link
                    href={checkoutUrl}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-500 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white transition-all hover:bg-orange-400"
                  >
                    <CreditCard className="size-3" aria-hidden="true" />
                    Choose a plan &amp; pay
                  </Link>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={loading}
                className="h-8.5 px-3 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[11px] font-semibold text-[var(--m-text-secondary)]/90">Password</Label>
                <Link href="/forgot-password" className="text-[10px] text-orange-500 hover:text-orange-400 font-medium transition-colors">Forgot password?</Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  className="h-8.5 pl-3 pr-9 w-full border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-[11px] text-[var(--m-text-primary)] focus-visible:border-orange-500/70 focus-visible:ring-orange-500/10 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              id="sign-in-btn"
              className="mt-1 h-8.5 w-full bg-orange-500 text-white hover:bg-orange-400 font-bold text-[11px] transition-all duration-200 border border-orange-400/20 shadow-md shadow-orange-500/20 cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  Authenticating…
                </span>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <p className="mt-4.5 text-center text-[11px] text-[var(--m-text-muted)]">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-orange-500 hover:text-orange-400 font-bold transition-colors">Create Account</Link>
          </p>
        </CardContent>
      </Card>

    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--m-bg-primary)]">
          <Loader2 className="size-6 animate-spin text-orange-500" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
