import React, { useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { TetherProvider, useTether } from "../TetherProvider";

function ClerkAuthSync() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { setToken, logout } = useTether();
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    let active = true;

    async function sync() {
      if (!isSignedIn) {
        if (lastTokenRef.current !== null) {
          lastTokenRef.current = null;
          logout();
        }
        return;
      }

      try {
        const token = await getToken();
        if (active && token && token !== lastTokenRef.current) {
          lastTokenRef.current = token;
          setToken(token);
        }
      } catch (err) {
        console.error("[Tether] Clerk token retrieval failed", err);
        if (active) {
          lastTokenRef.current = null;
          logout();
        }
      }
    }

    sync();

    // Keep lease fresh for idle long-lived tabs
    const interval = setInterval(sync, 45_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isLoaded, isSignedIn, getToken, setToken, logout]);

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