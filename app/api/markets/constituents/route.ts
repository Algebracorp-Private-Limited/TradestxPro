import { getConstituents, hasConstituents } from "@/lib/constituents";
import { fail, json, userHandler } from "@/lib/api";

export const GET = userHandler(async ({ req }) => {
  const index = new URL(req.url).searchParams.get("index") ?? "";
  if (!hasConstituents(index)) return fail("Constituent list not available for this index.", 404);
  return json({ ok: true, index: index.toUpperCase(), constituents: await getConstituents(index) });
});
