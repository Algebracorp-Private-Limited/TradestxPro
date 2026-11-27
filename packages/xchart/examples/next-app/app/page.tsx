import { ChartClient } from "./chart-client";

// Server component: the page is pre-rendered on the server (SSR); the chart mounts on the client.
export default function Page() {
  return (
    <main>
      <h1 style={{ color: "#cbd5e1", font: "16px system-ui", padding: 12 }}>XChart on Next.js</h1>
      <ChartClient />
    </main>
  );
}
