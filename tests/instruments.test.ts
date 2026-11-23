import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseCsvLine } from "../lib/csv.ts";
import { istToday, mapBse, mapContract, mapNse, parseIciciDate } from "../lib/instrument-map.ts";

test("csv line parser handles quotes, blanks and spaces", () => {
  assert.deepEqual(parseCsvLine(`"a", "b",3,,"x""y",`), ["a", "b", "3", "", 'x"y', ""]);
  assert.deepEqual(parseCsvLine(`1,"2"`), ["1", "2"]);
});

test("ICICI dates", () => {
  assert.equal(parseIciciDate("23-Nov-2026"), "2026-11-23");
  assert.equal(parseIciciDate("1-Dec-2026"), "2026-12-01");
  assert.equal(parseIciciDate("01-Jan-1980"), "1980-01-01");
  assert.equal(parseIciciDate("bad"), null);
});

test("IST date rolls over at 18:30 UTC", () => {
  assert.equal(istToday(new Date("2026-11-16T18:29:00Z")), "2026-11-16");
  assert.equal(istToday(new Date("2026-11-16T18:31:00Z")), "2026-11-17");
});

const nseCsv = `"Token", "ShortName", "Series", "CompanyName", "ticksize", "Lotsize", "FaceValue", "ISINCode", "ExchangeCode"
"2885","RELIND","EQ","RELIANCE INDUSTRIES",0.01,1,10,"INE002A01018","RELIANCE"
"0","ACRTEC","BE","ACROPETAL",0.01,1,10,"INE055L01013","ACROPETAL"
"9999","GOI","GS","GOVT BOND",0.01,1,100,"IN0020020106","GS2030"`;

test("NSE mapping keeps equities with real tokens", () => {
  const rows = [...parseCsv(nseCsv)].map(mapNse);
  assert.deepEqual(rows[0], {
    exchange: "NSE", token: "2885", symbol: "RELIANCE", breeze_code: "RELIND", name: "RELIANCE INDUSTRIES",
    series: "EQ", isin: "INE002A01018", tick_size: 0.01, lot_size: 1, face_value: 10,
  });
  assert.equal(rows[1], null); // token 0
  assert.equal(rows[2], null); // not an equity series
});

test("BSE mapping keeps equity ISINs only", () => {
  const eq = mapBse({ ScripCode: "500325", ScripID: "RELIANCE", ShortName: "RELIND", ScripName: "RELIANCE INDUSTRIES", CompanyName: "", ISINCode: "INE002A01018", LotSize: "1", FaceValue: "10" });
  assert.equal(eq?.symbol, "RELIANCE");
  assert.equal(eq?.token, "500325");
  const bond = mapBse({ ScripCode: "800078", ScripID: "CG1110S9803", ShortName: "03D001", ScripName: "GOI LOAN", CompanyName: "", ISINCode: "INY019980013", LotSize: "1", FaceValue: "100" });
  assert.equal(bond, null);
});

test("contract mapping: index option, stock future, expired", () => {
  const base = { Token: "1", ShortName: "NIFTY", ExpiryDate: "25-Nov-2026", StrikePrice: "24000", OptionType: "CE", LotSize: "65", TickSize: "5", CompanyName: "NIFTY 50", ExAllowed: "NFO", ExchangeCode: "NIFTY 50" };
  const opt = mapContract({ ...base, InstrumentName: "OPTIDX" }, "NFO", "2026-11-16");
  assert.deepEqual(opt, {
    exchange: "NFO", token: "1", instrument_type: "OPTIDX", underlying: "NIFTY", underlying_name: "NIFTY 50",
    breeze_code: "NIFTY", expiry: "2026-11-25", strike: 24000, option_type: "CE", lot_size: 65, tick_size: 5,
  });
  const bank = mapContract({ ...base, ShortName: "CNXBAN", InstrumentName: "FUTIDX", OptionType: "XX" }, "NFO", "2026-11-16");
  assert.equal(bank?.underlying, "BANKNIFTY");
  assert.equal(bank?.strike, null);
  assert.equal(bank?.option_type, null);
  const stk = mapContract({ ...base, ShortName: "SWILIM", ExchangeCode: "SWIGGY", InstrumentName: "FUTSTK", OptionType: "XX" }, "NFO", "2026-11-16");
  assert.equal(stk?.underlying, "SWIGGY");
  assert.equal(mapContract({ ...base, InstrumentName: "OPTIDX", ExpiryDate: "10-Nov-2026" }, "NFO", "2026-11-16"), null);
  const sensex = mapContract({ ...base, ShortName: "BSESEN", InstrumentName: "FUTIND", OptionType: "XX", ExAllowed: "BFO" }, "BFO", "2026-11-16");
  assert.equal(sensex?.instrument_type, "FUTIDX");
  assert.equal(sensex?.underlying, "SENSEX");
  assert.equal(sensex?.exchange, "BFO");
});

test("F&O bhavcopy aggregation", async () => {
  const { parseFoBhavcopy } = await import("../lib/eod-parse.ts");
  const csv = `TradDt,FinInstrmTp,TckrSymb,OptnTp,ClsPric,OpnIntrst,TtlTradgVol,TtlTrfVal,NewBrdLotQty
2026-11-20,IDO,NIFTY,CE,100,6500,10,1000000,65
2026-11-20,IDO,NIFTY,PE,50,13000,4,500000,65
2026-11-20,STF,TCS,,2400,1750,3,12600000,175
2026-11-20,FUTCOM,GOLD,,1,1,1,1,1`;
  const rows = parseFoBhavcopy(csv);
  const n = rows.find((r) => r.underlying === "NIFTY")!;
  assert.equal(n.contracts, 14);
  assert.equal(n.ce_contracts, 10);
  assert.equal(n.pe_oi_qty, 13000);
  assert.equal(n.premium_turnover, 10 * 65 * 100 + 4 * 65 * 50);
  assert.equal(rows.length, 2);
});

test("F&O bhavcopy option contracts", async () => {
  const { parseFoContracts } = await import("../lib/eod-parse.ts");
  const csv = `TradDt,FinInstrmTp,TckrSymb,XpryDt,StrkPric,OptnTp,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,NewBrdLotQty
2026-11-20,IDO,NIFTY,2026-11-25,26000,CE,120.5,121,100,25950,65000,13000,500,65
2026-11-20,IDO,NIFTY,2026-11-25,27000,PE,0,0,0,25950,0,0,0,65
2026-11-20,STF,TCS,2026-11-25,,,2400,2400,2390,2398,1750,0,3,175`;
  const rows = parseFoContracts(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { underlying: "NIFTY", inst: "IDO", expiry: "2026-11-25", strike: 26000, opt: "CE", close: 120.5, prev_close: 100, underlying_px: 25950, oi_qty: 65000, oi_chg_qty: 13000, contracts: 500, lot: 65 });
});
