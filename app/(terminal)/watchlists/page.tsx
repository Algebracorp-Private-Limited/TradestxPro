import type { Metadata } from "next";
import { WatchlistManager } from "@/components/watchlist-manager";

export const metadata: Metadata = { title: "Watchlists" };

export default function Watchlists() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlists</h1>
        <p className="mt-1 text-sm text-muted">Up to 10 lists, 250 symbols each. Prices are live when a broker is connected.</p>
      </div>
      <WatchlistManager />
    </>
  );
}
