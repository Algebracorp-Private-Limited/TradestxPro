export const metadata = { title: "XChart on Next.js" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0f17" }}>{children}</body>
    </html>
  );
}
