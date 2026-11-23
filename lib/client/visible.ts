/** Runs fn now if the page is visible, otherwise as soon as it becomes visible (saves polling in background tabs). */
export function whenVisible(fn: () => void): void {
  if (typeof document === "undefined" || !document.hidden) return fn();
  const on = () => {
    if (document.hidden) return;
    document.removeEventListener("visibilitychange", on);
    fn();
  };
  document.addEventListener("visibilitychange", on);
}
