import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

export default async function Page() {
  if (await getSessionUser().catch(() => null)) redirect("/dashboard");
  return (
    <AuthShell title="Create your account" subtitle="7-day free trial. No card required.">
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </AuthShell>
  );
}
