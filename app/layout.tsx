import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TradestXPro — Indian market intelligence terminal", template: "%s · TradestXPro" },
  description:
    "Research terminal for NSE, BSE, F&O, MCX and FX: charts, screeners, option analytics and evidence-led AI analysis.",
};

export const viewport: Viewport = { themeColor: "#05070b" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
