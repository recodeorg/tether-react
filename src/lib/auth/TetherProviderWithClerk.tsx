import React, { useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { TetherProvider, useTether } from "../TetherProvider";

// Refresh this long before the token's `exp` so the server never sees an expired lease
const REFRESH_LEEWAY_MS = 15_000;
// Used when the token has no readable `exp` claim
const FALLBACK_REFRESH_MS = 30_000;
const MIN_REFRESH_MS = 1_000;
const RETRY_MS = 5_000;

function getTokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function msUntilRefresh(token: string): number {
  const expiry = getTokenExpiry(token);
  if (expiry === null) return FALLBACK_REFRESH_MS;
  return Math.max(expiry - Date.now() - REFRESH_LEEWAY_MS, MIN_REFRESH_MS);
}

function ClerkAuthSync() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { setToken, logout } = useTether();
  const lastTokenRef = useRef<string | null>(null);

  // logout is recreated on every TetherProvider render; keep it out of the effect deps
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    if (!isLoaded) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(ms: number) {
      clearTimeout(timer);
      if (active) timer = setTimeout(sync, ms);
    }

    async function fetchFreshToken(): Promise<string | null> {
      const token = await getToken();
      // Clerk hands back its cached token until it is nearly expired; if that is
      // inside our leeway, force a new one instead of reusing it
      if (token && msUntilRefresh(token) <= MIN_REFRESH_MS) {
        return getToken({ skipCache: true });
      }
      return token;
    }

    async function sync() {
      if (!isSignedIn) {
        if (lastTokenRef.current !== null) {
          lastTokenRef.current = null;
          logoutRef.current();
        }
        return;
      }

      try {
        const token = await fetchFreshToken();
        if (!active) return;
        if (!token) {
          schedule(RETRY_MS);
          return;
        }
        if (token !== lastTokenRef.current) {
          lastTokenRef.current = token;
          setToken(token);
        }
        schedule(msUntilRefresh(token));
      } catch (err) {
        console.error("[Tether] Clerk token retrieval failed", err);
        if (active) {
          lastTokenRef.current = null;
          logoutRef.current();
          schedule(RETRY_MS);
        }
      }
    }

    // Timers are throttled in background tabs; resync as soon as the tab is visible again
    function onVisible() {
      if (document.visibilityState === "visible") sync();
    }

    sync();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isLoaded, isSignedIn, getToken, setToken]);

  return null;
}

export function TetherProviderWithClerk({
  children,
  url,
}: { children: React.ReactNode, url: string }) {
  return (
    <TetherProvider url={url}>
      <ClerkAuthSync />
      {children}
    </TetherProvider>
  );
}
