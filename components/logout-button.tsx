"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        router.push("/");
        router.refresh();
      }}
      disabled={busy}
      className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:bg-white/5 hover:text-white disabled:opacity-60"
    >
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
