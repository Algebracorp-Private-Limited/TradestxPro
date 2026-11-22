// Broker catalogue (client-safe: no secrets, no server imports).

export type BrokerId = "icici" | "kotak" | "dhan" | "zerodha" | "upstox" | "angel" | "fyers";

export type FieldDef = { key: string; label: string; type?: "text" | "password" | "tel"; placeholder?: string; help?: string; store: boolean; inputMode?: "numeric" | "text" };

export type BrokerInfo = {
  id: BrokerId;
  name: string;
  api: string;
  stage: "ready" | "beta";
  /** platform = TradestXPro's own app (env keys); user-app = each user registers their own API app. */
  mode: "redirect-platform" | "redirect-user-app" | "form";
  fields: FieldDef[];
  features: { history: boolean; quotes: boolean };
  steps: string[];
  note?: string;
  envKeys?: string[];
};

export const CALLBACK_PATH = (id: BrokerId) => `/api/brokers/${id}/callback`;

export const BROKERS: BrokerInfo[] = [
  {
    id: "icici",
    name: "ICICI Direct",
    api: "Breeze API",
    stage: "ready",
    mode: "redirect-user-app",
    fields: [
      { key: "appKey", label: "App Key", store: true, help: "From api.icicidirect.com → View Apps" },
      { key: "secretKey", label: "Secret Key", type: "password", store: true },
    ],
    features: { history: true, quotes: true },
    steps: [
      "Log in at api.icicidirect.com and open “Register an App”.",
      "Redirect URL: https://www.tradestxpro.com/api/brokers/icici/callback",
      "Primary IP: your current internet IP (search “what is my IP”).",
      "Copy the App Key and Secret Key here, then click Connect — you'll log in on ICICI's page.",
    ],
    note: "ICICI requires a fresh login each day.",
  },
  {
    id: "kotak",
    name: "Kotak Securities",
    api: "Neo Trade API",
    stage: "ready",
    mode: "form",
    fields: [
      { key: "consumerKey", label: "Neo API token (consumer key)", type: "password", store: true, help: "Neo app/web → Invest → Trade API → Generate application" },
      { key: "ucc", label: "Client code (UCC)", store: true, help: "Profile section in the Neo app" },
      { key: "mobile", label: "Registered mobile", type: "tel", placeholder: "+91…", store: true },
      { key: "totp", label: "TOTP (6 digits)", inputMode: "numeric", store: false, help: "From your authenticator app (register TOTP once on Kotak's Trade API page)" },
      { key: "mpin", label: "MPIN", type: "password", inputMode: "numeric", store: false, help: "Sent to Kotak only to log in — never stored" },
    ],
    features: { history: false, quotes: true },
    steps: [
      "In the Kotak Neo app or website: Invest → Trade API → generate an application and copy the token.",
      "Register TOTP once at kotaksecurities.com/platform/kotak-neo-trade-api and scan the QR in Google/Microsoft Authenticator.",
      "Enter the details here with today's TOTP and your MPIN.",
    ],
    note: "Kotak's API has no historical candles, so charts keep using NSE end-of-day data; live quotes come from Kotak.",
  },
  {
    id: "dhan",
    name: "Dhan",
    api: "DhanHQ API v2",
    stage: "ready",
    mode: "form",
    fields: [
      { key: "clientId", label: "Dhan Client ID", store: true },
      { key: "accessToken", label: "Access token", type: "password", store: true, help: "web.dhan.co → My Profile → Access DhanHQ APIs → Generate token" },
    ],
    features: { history: true, quotes: true },
    steps: [
      "Log in at web.dhan.co → My Profile → “Access DhanHQ APIs”.",
      "Generate an access token (and enable Data APIs if prompted).",
      "Paste your Client ID and the token here.",
    ],
    note: "Dhan's market-data APIs may need the Data API plan active on your Dhan account.",
  },
  {
    id: "zerodha",
    name: "Zerodha",
    api: "Kite Connect",
    stage: "beta",
    mode: "redirect-platform",
    fields: [],
    features: { history: true, quotes: true },
    steps: ["Click Connect and log in on Zerodha's page."],
    note: "Historical data needs the Kite Connect historical add-on on the platform app.",
    envKeys: ["KITE_API_KEY", "KITE_API_SECRET"],
  },
  {
    id: "upstox",
    name: "Upstox",
    api: "Upstox API v2",
    stage: "beta",
    mode: "redirect-platform",
    fields: [],
    features: { history: true, quotes: true },
    steps: ["Click Connect and log in on Upstox's page."],
    envKeys: ["UPSTOX_CLIENT_ID", "UPSTOX_CLIENT_SECRET"],
  },
  {
    id: "angel",
    name: "Angel One",
    api: "SmartAPI",
    stage: "beta",
    mode: "redirect-platform",
    fields: [],
    features: { history: true, quotes: true },
    steps: ["Click Connect and log in on Angel One's page."],
    envKeys: ["ANGEL_API_KEY"],
  },
  {
    id: "fyers",
    name: "Fyers",
    api: "Fyers API v3",
    stage: "beta",
    mode: "redirect-platform",
    fields: [],
    features: { history: true, quotes: true },
    steps: ["Click Connect and log in on Fyers' page."],
    envKeys: ["FYERS_APP_ID", "FYERS_SECRET"],
  },
];

export const BROKER_BY_ID = Object.fromEntries(BROKERS.map((b) => [b.id, b])) as Record<BrokerId, BrokerInfo>;

export function isBrokerId(v: string): v is BrokerId {
  return Object.hasOwn(BROKER_BY_ID, v);
}
