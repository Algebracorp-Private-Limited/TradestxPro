import { Logo } from "./site";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center px-4 py-12">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-line bg-panel p-6 shadow-2xl sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 mb-6 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-muted">
          Research tool only. Not investment advice. By continuing you agree to the{" "}
          <a href="/disclaimer" className="underline hover:text-white">disclaimer</a>.
        </p>
      </div>
    </main>
  );
}
