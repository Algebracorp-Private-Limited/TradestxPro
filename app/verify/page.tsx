import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Verify your email" };
export const dynamic = "force-dynamic";

export default async function Page() {
  if (await getSessionUser().catch(() => null)) redirect("/dashboard");
  return (
    <AuthShell title="Verify your email" subtitle="One quick step to secure your account.">
      <Suspense>
        <AuthForm mode="verify" />
      </Suspense>
    </AuthShell>
  );
}
