import type { Metadata } from "next";
import { Suspense } from "react";
import { BrokerConnections } from "@/components/broker-connections";

export const metadata: Metadata = { title: "Broker Connections" };

export default function BrokersPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Broker Connections</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Connect your own broker account to see live and intraday data from it on TradestXPro. Your login happens on the
          broker&apos;s side or with your own API keys. Keys and session tokens are encrypted, and TradestXPro cannot move
          your funds. Order placement is not enabled.
        </p>
      </div>
      <Suspense>
        <BrokerConnections />
      </Suspense>
      <section className="rounded-2xl border border-line bg-panel p-5 text-sm leading-6 text-soft">
        <h2 className="font-semibold text-white">How your data is handled</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Market data is fetched with your own account&apos;s access and shown only to you.</li>
          <li>Secrets such as API keys and access tokens are stored encrypted (AES-256-GCM). TOTP codes and MPINs are never stored.</li>
          <li>Most broker sessions expire every morning. Reconnect with one click.</li>
          <li>Remove a broker at any time. Removing it deletes everything we stored for it.</li>
        </ul>
      </section>
    </>
  );
}
