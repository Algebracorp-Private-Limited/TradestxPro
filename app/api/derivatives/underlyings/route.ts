import { listUnderlyings } from "@/lib/market-data";
import { json, userHandler } from "@/lib/api";

export const GET = userHandler(async () => json({ ok: true, underlyings: await listUnderlyings() }));
