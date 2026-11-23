"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { whenVisible } from "@/lib/client/visible";

/** Re-renders the server page every `seconds` while the tab is visible (for live prices). */
export function AutoRefresh({ seconds = 20, enabled = true }: { seconds?: number; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      router.refresh();
      t = setTimeout(() => whenVisible(tick), seconds * 1000);
    };
    t = setTimeout(() => whenVisible(tick), seconds * 1000);
    return () => clearTimeout(t);
  }, [router, seconds, enabled]);
  return null;
}
