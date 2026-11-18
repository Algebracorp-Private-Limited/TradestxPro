import { listIndices } from "@/lib/chart-data";
import { json, userHandler } from "@/lib/api";

export const GET = userHandler(async () => json({ ok: true, indices: await listIndices() }));
