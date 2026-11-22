import { buildTiles, getDashboardKeys } from "@/lib/overview";
import { json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ user }) => {
  const { keys, custom } = await getDashboardKeys(user.id);
  const r = await buildTiles(user.id, keys);
  return json({ ok: true, custom, ...r });
});
