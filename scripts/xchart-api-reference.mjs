// Generates the XChart API reference (app/developers/api-reference/api.json) from the SDK's public
// entry point with the TypeScript compiler API: every export of lib/xchart-sdk/index.ts, with its
// kind, signature and JSDoc, and the members of exported interfaces/classes.
//   node scripts/xchart-api-reference.mjs           write the file
//   node scripts/xchart-api-reference.mjs --check   exit 1 when the committed file is stale
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ts = createRequire(join(ROOT, "package.json"))("typescript");
const ENTRY = join(ROOT, "lib/xchart-sdk/index.ts");
const OUT = join(ROOT, "app/developers/api-reference/api.json");

const program = ts.createProgram([ENTRY], {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
});
const checker = program.getTypeChecker();
const entry = program.getSourceFile(ENTRY);
const moduleSym = checker.getSymbolAtLocation(entry);
const flat = (s) => s.replace(/\s+/g, " ").trim();
const docOf = (sym) => flat(ts.displayPartsToString(sym.getDocumentationComment(checker)));
const modOf = (decl) => relative(join(ROOT, "lib/xchart-sdk"), decl.getSourceFile().fileName).replace(/\\/g, "/").replace(/^\.\.\/\.\.\//, "");

function kindOf(decl) {
  if (ts.isInterfaceDeclaration(decl)) return "interface";
  if (ts.isClassDeclaration(decl)) return "class";
  if (ts.isFunctionDeclaration(decl)) return "function";
  if (ts.isTypeAliasDeclaration(decl)) return "type";
  if (ts.isEnumDeclaration(decl)) return "enum";
  if (ts.isVariableDeclaration(decl)) return "const";
  if (ts.isModuleDeclaration(decl) || ts.isSourceFile(decl) || ts.isNamespaceExport?.(decl)) return "namespace";
  return "other";
}

function signatureOf(sym, decl, kind) {
  if (kind === "function") {
    const sigs = checker.getTypeOfSymbolAtLocation(sym, decl).getCallSignatures();
    return sigs.map((s) => `${sym.name}${checker.signatureToString(s)}`).join("\n");
  }
  if (kind === "const") return `const ${sym.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, decl), undefined, ts.TypeFormatFlags.NoTruncation)}`;
  if (kind === "type") return flat(decl.getText()).slice(0, 1200);
  if (kind === "class") {
    const heritage = decl.heritageClauses?.map((h) => h.getText()).join(" ") ?? "";
    return `class ${sym.name}${heritage ? " " + heritage : ""}`;
  }
  if (kind === "interface") return `interface ${sym.name}`;
  return sym.name;
}

function membersOf(sym, decl, kind) {
  if (kind !== "interface" && kind !== "class") return undefined;
  const out = [];
  for (const m of decl.members) {
    if (!m.name) continue;
    if (m.modifiers?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)) continue;
    const name = m.name.getText();
    if (name.startsWith("#")) continue;
    const msym = checker.getSymbolAtLocation(m.name);
    const doc = msym ? docOf(msym) : "";
    if (/@internal/.test(m.getFullText())) continue;
    let sig;
    if (ts.isMethodSignature(m) || ts.isMethodDeclaration(m)) {
      const s = checker.getSignatureFromDeclaration(m);
      sig = `${name}${s ? checker.signatureToString(s) : ""}`;
    } else if (ts.isConstructorDeclaration(m)) {
      sig = `new ${sym.name}(${m.parameters.map((p) => p.getText()).join(", ")})`;
    } else {
      sig = flat(m.getText()).replace(/;$/, "").slice(0, 400);
    }
    out.push({ name, signature: sig, doc });
  }
  return out;
}

const items = [];
for (const exp of checker.getExportsOfModule(moduleSym)) {
  const sym = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
  const decl = sym.declarations?.[0];
  if (!decl) continue;
  let kind = kindOf(decl);
  if (ts.isSourceFile(decl)) kind = "namespace";
  const item = { name: exp.name, kind, module: ts.isSourceFile(decl) ? modOf(decl) : modOf(decl), doc: docOf(sym) };
  if (kind === "namespace") item.signature = `namespace ${exp.name} (${checker.getExportsOfModule(sym).length} exports)`;
  else {
    item.signature = signatureOf(sym, decl, kind);
    const members = membersOf(sym, decl, kind);
    if (members) item.members = members;
  }
  items.push(item);
}
items.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
const version = /XCHART_VERSION = "([^"]+)"/.exec(readFileSync(ENTRY, "utf8"))[1];
const json = JSON.stringify({ version, generatedFrom: "lib/xchart-sdk/index.ts", count: items.length, items }, null, 1) + "\n";

if (process.argv.includes("--check")) {
  let cur = "";
  try {
    cur = readFileSync(OUT, "utf8");
  } catch {}
  if (cur !== json) {
    console.error("app/developers/api-reference/api.json is stale: run node scripts/xchart-api-reference.mjs");
    process.exit(1);
  }
  console.log(`API reference up to date (${items.length} exports)`);
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${relative(ROOT, OUT)}: ${items.length} exports`);
}
