"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  KeyRound,
  CheckCircle2,
  X,
  ArrowLeft,
} from "lucide-react";
import { useSiteConfig } from "@/context/site-config-context";

/* ─────────────────────────────────────────────
   Forgot-password modal (3-step)
   Step 1 → verify permanent access token
   Step 2 → new password + confirm
   Step 3 → success
───────────────────────────────────────────── */
function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // step 1
  const [accessToken, setAccessToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  // step 2
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // close on Escape
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Step 1 → verify token with the server before moving to step 2 */
  const handleVerifyToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!accessToken.trim()) {
      setError("Please enter the access token.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          accessToken: accessToken.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStep(2);
      } else {
        setError(data.error ?? "Invalid access token.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* Step 2 → reset password */
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setStep(3);
      } else {
        setError(data.error ?? "Reset failed. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    /* Overlay */
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,15,30,0.55)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      {/* Modal card */}
      <div
        className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl"
        style={{ animation: "modalIn 0.22s ease" }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>

        <div className="p-6">
          {/* ── STEP 1: Verify Access Token ── */}
          {step === 1 && (
            <form onSubmit={handleVerifyToken} className="space-y-4">
              {/* Header */}
              <div className="flex flex-col items-center text-center mb-2">
                <div className="w-11 h-11 rounded-xl bg-violet-50 border border-violet-200/60 flex items-center justify-center mb-3">
                  <KeyRound className="size-5 text-violet-600" />
                </div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Reset Password
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Enter your permanent access token to continue
                </p>
              </div>

              {/* Access Token field */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Permanent Access Token
                </label>
                <div className="relative">
                  <input
                    id="forgot-access-token"
                    type={showToken ? "text" : "password"}
                    required
                    autoFocus
                    value={accessToken}
                    onChange={(e) => {
                      setAccessToken(e.target.value);
                      setError("");
                    }}
                    placeholder="Enter access token"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showToken ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <p className="text-[11px] text-red-600">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                id="verify-token-btn"
                disabled={loading}
                className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <KeyRound className="size-3.5" />
                    Verify Token & Continue
                  </>
                )}
              </button>
            </form>
          )}

          {/* ── STEP 2: New Password ── */}
          {step === 2 && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              {/* Back button */}
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setError("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-violet-600 transition-colors mb-1"
              >
                <ArrowLeft className="size-3" />
                Back
              </button>

              {/* Header */}
              <div className="flex flex-col items-center text-center">
                <div className="w-11 h-11 rounded-xl bg-violet-50 border border-violet-200/60 flex items-center justify-center mb-3">
                  <Lock className="size-5 text-violet-600" />
                </div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Set New Password
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Token verified · choose a new password
                </p>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    required
                    autoFocus
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setError("");
                    }}
                    placeholder="Min. 6 characters"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showNew ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError("");
                    }}
                    placeholder="Re-enter new password"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showConfirm ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Password match indicator */}
              {confirmPassword && (
                <p
                  className={`text-[10px] font-medium ${
                    newPassword === confirmPassword
                      ? "text-emerald-600"
                      : "text-red-500"
                  }`}
                >
                  {newPassword === confirmPassword
                    ? "✓ Passwords match"
                    : "✗ Passwords do not match"}
                </p>
              )}

              {/* Error */}
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <p className="text-[11px] text-red-600">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                id="reset-password-btn"
                disabled={loading}
                className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Lock className="size-3.5" />
                )}
                {loading ? "Resetting..." : "Reset Password"}
              </button>
            </form>
          )}

          {/* ── STEP 3: Success ── */}
          {step === 3 && (
            <div className="flex flex-col items-center text-center py-4 space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <CheckCircle2 className="size-7 text-emerald-500" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  Password Reset!
                </h2>
                <p className="text-[11px] text-slate-400 mt-1 max-w-[220px]">
                  Your super admin password has been updated. Please log in with
                  your new password.
                </p>
              </div>
              <button
                id="goto-login-btn"
                onClick={onClose}
                className="mt-2 w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
              >
                <Shield className="size-3.5" />
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Login Page
───────────────────────────────────────────── */
export default function SuperAdminLoginPage() {
  const router = useRouter();
  const { config } = useSiteConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForgot, setShowForgot] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Invalid credentials");
      } else {
        router.push("/super-admin");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Keyframe for modal entrance */}
      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>

      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 relative overflow-hidden">
        {/* Subtle colorful blur blobs in background */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-200/50 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-indigo-200/40 blur-[100px] rounded-full pointer-events-none" />

        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(100,116,139,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(100,116,139,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

        <div className="relative w-full max-w-sm">
          {/* Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            {/* Header */}
            <div className="flex flex-col items-center mb-6 text-center">
              {/* Logo icon or uploaded brand logo */}
              <div className="relative mb-3 flex items-center justify-center">
                {config.logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={config.logoUrl}
                    alt={config.siteName}
                    className="h-10 w-auto object-contain"
                  />
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-violet-50 border border-violet-200/60 flex items-center justify-center text-violet-600">
                      <Shield className="size-6 text-violet-600" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-violet-600 border-2 border-white flex items-center justify-center">
                      <Lock className="size-2 text-white" />
                    </div>
                  </>
                )}
              </div>
              <h1 className="text-base font-semibold text-slate-800">
                Super Admin Portal
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {config.siteName} Administration
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {/* Email */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@hashtagscrm.com"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/20 transition-all"
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Password
                  </label>
                  <button
                    type="button"
                    id="forgot-password-link"
                    onClick={() => setShowForgot(true)}
                    className="text-[10px] font-medium text-violet-600 hover:text-violet-700 hover:underline transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPass ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <p className="text-[11px] text-red-600">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                id="super-admin-login-btn"
                disabled={loading}
                className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 mt-2"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Shield className="size-3.5" />
                )}
                {loading ? "Authenticating..." : "Access Super Admin Portal"}
              </button>
            </form>

            <p className="text-center text-[10px] text-slate-400 mt-5">
              Restricted access · Authorized personnel only
            </p>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgot && (
        <ForgotPasswordModal onClose={() => setShowForgot(false)} />
      )}
    </>
  );
}
