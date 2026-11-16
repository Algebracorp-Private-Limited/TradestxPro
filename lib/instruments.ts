import "server-only";
import { unzipSync } from "fflate";
import { db } from "./db";
import { parseCsv } from "./csv";
import { istToday, mapBse, mapContract, mapNse, type CashInstrument, type Contract } from "./instrument-map";

export const SECURITY_MASTER_URL = "https://directlink.icicidirect.com/NewSecurityMaster/SecurityMaster.zip";
const CHUNK = 2000;

function decode(files: Record<string, Uint8Array>, name: string): string {
  // Exact basename match: "NSEScripMaster.txt" must not match "FONSEScripMaster.txt".
  const key = Object.keys(files).find((k) => (k.split("/").pop() ?? "").toLowerCase() === name.toLowerCase());
  if (!key) throw new Error(`Security master is missing ${name}`);
  return new TextDecoder("latin1").decode(files[key]);
}

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type SyncResult = { syncId: number; counts: Record<string, number>; ms: number };

/** Downloads ICICI's public security master and refreshes instruments + derivative contracts. */
export async function syncInstruments(): Promise<SyncResult> {
  const t0 = Date.now();
  const sql = await db();
  const [{ id: syncIdRaw }] = await sql<{ id: string }[]>`
    INSERT INTO instrument_syncs (source) VALUES ('icici-security-master') RETURNING id`;
  const syncId = Number(syncIdRaw);

  try {
    const res = await fetch(SECURITY_MASTER_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Security master download failed: HTTP ${res.status}`);
    const lastModified = res.headers.get("last-modified");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));

    const cash: CashInstrument[] = [];
    for (const r of parseCsv(decode(files, "NSEScripMaster.txt"))) {
      const m = mapNse(r);
      if (m) cash.push(m);
    }
    for (const r of parseCsv(decode(files, "BSEScripMaster.txt"))) {
      const m = mapBse(r);
      if (m) cash.push(m);
    }

    const today = istToday();
    const contracts: Contract[] = [];
    for (const [file, ex] of [["FONSEScripMaster.txt", "NFO"], ["FOBSEScripMaster.txt", "BFO"]] as const) {
      for (const r of parseCsv(decode(files, file))) {
        const m = mapContract(r, ex, today);
        if (m) contracts.push(m);
      }
    }
    if (cash.length < 1000 || contracts.length < 1000) {
      throw new Error(`Security master looks incomplete (cash ${cash.length}, contracts ${contracts.length})`);
    }

    const startedAt = new Date(t0);
    await sql.begin(async (tx) => {
      for (const part of chunks(cash)) {
        const rows = part.map((c) => ({ ...c, synced_at: startedAt, active: true }));
        await tx`
          INSERT INTO instruments ${tx(rows, "exchange", "token", "symbol", "breeze_code", "name", "series", "isin", "tick_size", "lot_size", "face_value", "synced_at", "active")}
          ON CONFLICT (exchange, token) DO UPDATE SET
            symbol = EXCLUDED.symbol, breeze_code = EXCLUDED.breeze_code, name = EXCLUDED.name,
            series = EXCLUDED.series, isin = EXCLUDED.isin, tick_size = EXCLUDED.tick_size,
            lot_size = EXCLUDED.lot_size, face_value = EXCLUDED.face_value,
            synced_at = EXCLUDED.synced_at, active = true`;
      }
      await tx`UPDATE instruments SET active = false WHERE synced_at < ${startedAt} AND active`;

      await tx`DELETE FROM derivative_contracts`;
      for (const part of chunks(contracts)) {
        await tx`
          INSERT INTO derivative_contracts ${tx(part, "exchange", "token", "instrument_type", "underlying", "underlying_name", "breeze_code", "expiry", "strike", "option_type", "lot_size", "tick_size")}
          ON CONFLICT (exchange, token) DO NOTHING`;
      }

      await tx`
        UPDATE instruments i SET has_derivatives = EXISTS (
          SELECT 1 FROM derivative_contracts d
           WHERE d.underlying = i.symbol
             AND d.exchange = CASE i.exchange WHEN 'NSE' THEN 'NFO' ELSE 'BFO' END
             AND d.instrument_type IN ('FUTSTK', 'OPTSTK'))`;
    });

    const counts = {
      nse: cash.filter((c) => c.exchange === "NSE").length,
      bse: cash.filter((c) => c.exchange === "BSE").length,
      nfo: contracts.filter((c) => c.exchange === "NFO").length,
      bfo: contracts.filter((c) => c.exchange === "BFO").length,
    };
    await sql`UPDATE instrument_syncs SET status = 'ok', finished_at = now(), counts = ${sql.json(counts)},
              file_date = ${lastModified ? new Date(lastModified) : null} WHERE id = ${syncId}`;
    return { syncId, counts, ms: Date.now() - t0 };
  } catch (e) {
    await sql`UPDATE instrument_syncs SET status = 'error', finished_at = now(), error = ${String(e).slice(0, 500)}
              WHERE id = ${syncId}`;
    throw e;
  }
}

export type SyncStatus = { status: string; finishedAt: string | null; counts: Record<string, number> | null } | null;

export async function lastSync(): Promise<SyncStatus> {
  const sql = await db();
  const [row] = await sql<{ status: string; finished_at: Date | null; counts: Record<string, number> | null }[]>`
    SELECT status, finished_at, counts FROM instrument_syncs WHERE status = 'ok' ORDER BY id DESC LIMIT 1`;
  return row ? { status: row.status, finishedAt: row.finished_at?.toISOString() ?? null, counts: row.counts } : null;
}
