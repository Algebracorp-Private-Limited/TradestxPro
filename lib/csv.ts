// Minimal CSV line parser for ICICI security-master files: comma separated, optional double quotes,
// optional spaces after commas, no embedded newlines. Pure, unit tested.

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === ",") {
      out.push(wasQuoted ? cur : cur.trim());
      cur = "";
      wasQuoted = false;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      wasQuoted = true;
      cur = "";
    } else cur += ch;
  }
  out.push(wasQuoted ? cur : cur.trim());
  return out;
}

/** Yields records keyed by header name. */
export function* parseCsv(text: string): Generator<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0] ?? "").map((h) => h.trim());
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k];
    if (!line) continue;
    const cells = parseCsvLine(line);
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]] = cells[c] ?? "";
    // ICICI's FO files sometimes have more cells than headers; the last cell is ExchangeCode.
    if (cells.length !== header.length && header[header.length - 1] === "ExchangeCode") {
      rec.ExchangeCode = cells[cells.length - 1] ?? "";
    }
    yield rec;
  }
}
