import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { isDbConfigured, db } from "@/lib/db";
import { isEnabled } from "@/lib/flags";
import { accountsAvailable } from "@/lib/developers/accounts";
import { Note, PageHead, Section, Table } from "../_components/ui";
import { AccountConsole } from "../_components/account-console";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

async function status(): Promise<"disabled" | "not-configured" | "ready"> {
  if (!isEnabled("DEVELOPER_ACCOUNTS")) return "disabled";
  if (!isDbConfigured()) return "not-configured";
  try {
    return (await accountsAvailable(await db())) ? "ready" : "not-configured";
  } catch {
    return "not-configured";
  }
}

export default async function Account() {
  const s = await status();
  const user = s === "ready" ? await getSessionUser() : null;
  return (
    <>
      <PageHead title="Developer account" lead="Organisations, projects, API credentials and usage." />
      {s === "disabled" && <Note tone="warn">Developer accounts are not activated yet. The infrastructure below is implemented and tested but switched off; no registration, billing or credentials are offered.</Note>}
      {s === "not-configured" && <Note tone="warn">Developer accounts are enabled but their database tables have not been migrated. Nothing can be created yet.</Note>}
      {s === "ready" && !user && <Note>Please <Link className="text-accent" href="/login">sign in</Link> to manage organisations, projects and keys.</Note>}
      {s === "ready" && user && <div className="mt-4"><AccountConsole /></div>}
      <Section title="What is prepared">
        <Table head={["Capability", "Implementation"]} rows={[
          ["Registration", "Uses TradestXPro accounts (email OTP); a developer organisation is created by its owner."],
          ["Organisations and roles", "owner, admin, developer, viewer; every operation checks membership; other organisations are invisible (404)."],
          ["Projects", "Up to 20 per organisation, each with an optional https origin allow-list."],
          ["API credentials", "Random 256-bit keys shown once; only SHA-256 hashes stored; constant-time verification; up to 5 active keys per project."],
          ["Rotation and revocation", "Rotation issues a replacement and expires the old key after 24 hours; revocation is immediate."],
          ["Usage and rate limits", "Per-key, per-minute counters (35-day retention); per-key limit with HTTP 429 and rejected-request counts."],
          ["SDK entitlements", "Evaluation / commercial / enterprise records granted by platform administrators. No self-service billing."],
          ["Support", "Support-request records per organisation (no ticketing integration yet)."],
          ["Audit", "Organisation, project and key events are written to the audit log."],
        ]} />
        <p className="text-xs text-muted">Database: migration 001-developer-accounts (applied explicitly by an operator; never automatically). Feature flag: TXP_FLAG_DEVELOPER_ACCOUNTS.</p>
      </Section>
    </>
  );
}
