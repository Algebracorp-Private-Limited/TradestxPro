"use client";

import { useEffect, useState } from "react";

/** Dark / light switch. The choice is kept in this browser only. */
export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    Promise.resolve().then(() => setLight(document.documentElement.dataset.theme === "light"));
  }, []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("txp.theme", next ? "light" : "dark");
    } catch {}
    window.dispatchEvent(new Event("txp-theme"));
  };
  return (
    <button
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      title={light ? "Dark theme" : "Light theme"}
      className="grid h-9 w-9 place-items-center rounded-lg border border-line text-soft hover:bg-white/5 hover:text-white"
    >
      <span aria-hidden className="text-base leading-none">{light ? "☾" : "☀"}</span>
    </button>
  );
}
