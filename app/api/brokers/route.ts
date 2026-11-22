import { listConnections } from "@/lib/brokers/store";
import { isVaultConfigured } from "@/lib/brokers/vault";
import { BROKERS } from "@/lib/brokers/catalog";
import { json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ user }) => {
  const connections = await listConnections(user.id);
  const available = Object.fromEntries(BROKERS.map((b) => [b.id, !b.envKeys || b.envKeys.every((k) => Boolean(process.env[k]))]));
  return json({ ok: true, configured: isVaultConfigured(), connections, available });
});
