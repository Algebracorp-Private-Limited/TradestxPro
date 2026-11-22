import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`} aria-label="TradestXPro home">
      <span className="grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-gradient-to-br from-sky-400/25 to-emerald-400/10 font-mono text-[11px] font-black tracking-tight">
        TX
      </span>
      <span className="text-lg font-semibold tracking-tight">
        Tradest<span className="text-accent">X</span>Pro
      </span>
    </Link>
  );
}

export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-soft md:flex" aria-label="Main">
          <Link href="/#modules" className="hover:text-white">Modules</Link>
          <Link href="/algo-trading" className="hover:text-white">Algo Trading</Link>
          <Link href="/#pricing" className="hover:text-white">Pricing</Link>
          <Link href="/#roadmap" className="hover:text-white">Roadmap</Link>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/dashboard" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">
              Open terminal
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-3 py-2 text-sm text-soft hover:bg-white/5 hover:text-white">
                Log in
              </Link>
              <Link href="/signup" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">
                Start free trial
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm text-muted sm:px-6 md:grid-cols-[1fr_2fr] lg:px-8">
        <div className="space-y-3">
          <Logo />
          <p>© {new Date().getFullYear()} Algebracorp Private Limited</p>
        </div>
        <div className="space-y-3">
          <p className="leading-6">
            <strong className="text-soft">Disclaimer:</strong> TradestXPro is a research and education tool. Nothing on this
            site is investment advice or a recommendation to buy or sell any security. Trading in equities, derivatives,
            commodities and currencies involves substantial risk of loss. Consult a SEBI-registered investment adviser before
            investing.
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/algo-trading" className="hover:text-white">Algo trading</Link>
            <Link href="/disclaimer" className="hover:text-white">Full disclaimer</Link>
            <Link href="/signup" className="hover:text-white">Create account</Link>
            <Link href="/login" className="hover:text-white">Log in</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
