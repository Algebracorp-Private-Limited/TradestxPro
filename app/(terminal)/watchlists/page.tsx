import type { Metadata } from "next";
import { WatchlistManager } from "@/components/watchlist-manager";
import { FeedBanner } from "@/components/feed-banner";

export const metadata: Metadata = { title: "Watchlists" };

export default function Watchlists() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlists</h1>
        <p className="mt-1 text-sm text-muted">Up to 10 lists, 50 symbols each. Saved to your account.</p>
      </div>
      <FeedBanner compact />
      <WatchlistManager />
    </>
  );
}
