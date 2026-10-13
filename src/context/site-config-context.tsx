"use client";

/**
 * src/context/site-config-context.tsx
 *
 * Provides site branding, contact info, pricing overrides, and project settings
 * to all client components across the application.
 *
 * Populated at runtime from `/api/cms/public`. Falls back instantly to DEFAULT_CONFIG
 * so there is zero layout shift or hydration mismatch.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  DEFAULT_CONFIG,
  mergeOverrides,
  type SiteConfigData,
} from "@/lib/cms/site-config";
import {
  PLAN_IDS,
  PLANS,
  formatAmount,
  type Plan,
  type PlanId,
} from "@/lib/billing/plans";

interface SiteConfigContextType {
  config: SiteConfigData;
  plans: Record<PlanId, Plan>;
  planList: Plan[];
  currency: string;
  formatPrice: (amountMinor: number) => string;
  refreshConfig: () => Promise<void>;
  isLoading: boolean;
}

const SiteConfigContext = createContext<SiteConfigContextType>({
  config: DEFAULT_CONFIG,
  plans: PLANS,
  planList: PLAN_IDS.map((id) => PLANS[id]),
  currency: DEFAULT_CONFIG.billingCurrency,
  formatPrice: (amountMinor: number) => formatAmount(amountMinor, DEFAULT_CONFIG.billingCurrency),
  refreshConfig: async () => {},
  isLoading: true,
});

export function broadcastConfigUpdate() {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("cms_last_updated", Date.now().toString());
      window.dispatchEvent(new CustomEvent("cms-config-updated"));
    } catch {}
  }
}

export function SiteConfigProvider({
  children,
  initialConfig = DEFAULT_CONFIG,
}: {
  children: React.ReactNode;
  initialConfig?: SiteConfigData;
}) {
  const [config, setConfig] = useState<SiteConfigData>(initialConfig);
  const [isLoading, setIsLoading] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/cms/public?_t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setConfig((prev) => ({
            ...prev,
            ...json.data,
          }));
        }
      }
    } catch (err) {
      console.warn("Could not load dynamic CMS configuration, using defaults:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();

    const handleUpdate = () => {
      fetchConfig();
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "cms_last_updated") {
        fetchConfig();
      }
    };

    window.addEventListener("cms-config-updated", handleUpdate);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleUpdate);

    return () => {
      window.removeEventListener("cms-config-updated", handleUpdate);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleUpdate);
    };
  }, [fetchConfig]);

  // Keep client-side document title and favicon synchronized with CMS
  useEffect(() => {
    if (typeof document === "undefined") return;

    if (config.faviconUrl) {
      let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = config.faviconUrl;
    }

    if (config.metaTitle && (!document.title || document.title.includes("Hashtags CRM"))) {
      document.title = config.metaTitle;
    }
  }, [config.faviconUrl, config.metaTitle, config.siteName]);

  const currency = config.billingCurrency || DEFAULT_CONFIG.billingCurrency;

  const plans = useMemo(() => {
    return mergeOverrides(config.planOverrides, currency);
  }, [config.planOverrides, currency]);

  const planList = useMemo(() => {
    return PLAN_IDS.map((id) => plans[id]);
  }, [plans]);

  const formatPrice = useCallback(
    (amountMinor: number) => {
      return formatAmount(amountMinor, currency);
    },
    [currency]
  );

  return (
    <SiteConfigContext.Provider
      value={{
        config,
        plans,
        planList,
        currency,
        formatPrice,
        refreshConfig: fetchConfig,
        isLoading,
      }}
    >
      {/* Maintenance Mode Banner if active */}
      {config.maintenanceMode && (
        <div className="bg-amber-500 text-slate-950 font-medium px-4 py-2 text-center text-xs shadow-md z-[9999] sticky top-0 flex items-center justify-center gap-2">
          <span className="inline-block size-2 rounded-full bg-red-600 animate-pulse" />
          <span>
            <strong>Maintenance Mode:</strong>{" "}
            {config.maintenanceMessage || "The site is currently undergoing scheduled updates."}
          </span>
        </div>
      )}
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig() {
  return useContext(SiteConfigContext);
}
