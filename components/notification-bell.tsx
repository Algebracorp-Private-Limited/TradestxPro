"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { whenVisible } from "@/lib/client/visible";

/** Header bell with the unread notification count (polled every 5 minutes while the tab is visible). */
export function NotificationBell() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetch("/api/intelligence/notifications?count=1").then((r) => (r.ok ? r.json() : { unread: 0 })).then((j) => { if (alive) setN(Number(j.unread) || 0); }, () => {});
      timer = setTimeout(() => whenVisible(load), 300_000);
    };
    load();
    const onChange = () => load();
    window.addEventListener("txp:notifications", onChange);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener("txp:notifications", onChange); };
  }, []);
  return (
    <Link href="/ai-intelligence/monitor?tab=notifications" className="relative rounded-md border border-line px-2 py-1 text-sm text-soft hover:bg-white/5" aria-label={n ? `${n} unread notifications` : "Notifications"}>
      <span aria-hidden>🔔</span>
      {n > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-slate-950">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
