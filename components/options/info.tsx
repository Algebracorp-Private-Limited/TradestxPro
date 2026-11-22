"use client";

import { useState } from "react";

export const GLOSSARY: Record<string, string> = {
  LTP: "Last traded price — the price of the most recent trade in this contract.",
  "Spot": "Current price of the underlying index or stock the option is based on.",
  Bid: "Highest price a buyer is currently willing to pay. You sell at the bid.",
  Ask: "Lowest price a seller is currently asking. You buy at the ask (also called offer).",
  Spread: "Ask minus bid, shown as a % of the mid price. A small spread means the contract is liquid and cheaper to trade.",
  OI: "Open interest — the number of contracts currently open (not yet squared off). Rising OI means new positions are being added.",
  "OI Chg": "Change in open interest versus the previous day. Large OI build-up at a strike often marks support (puts) or resistance (calls).",
  Volume: "Number of contracts traded today.",
  IV: "Implied volatility — the volatility the option's price implies, annualised. Higher IV means more expensive options.",
  Delta: "How much the option price moves for a ₹1 move in the underlying. Calls 0 to 1, puts −1 to 0. Also a rough probability of expiring in the money.",
  Gamma: "How fast delta changes for a ₹1 move in the underlying. Highest for at-the-money options near expiry.",
  Theta: "Time decay — how much the option loses per day if nothing else changes. Negative for option buyers.",
  Vega: "How much the option price changes for a 1 percentage-point change in implied volatility.",
  Rho: "How much the option price changes for a 1 percentage-point change in interest rates. Usually small.",
  PCR: "Put-call ratio by open interest. Above 1 means more puts are open than calls; read alongside price action.",
  "Max pain": "The expiry price at which option buyers in total would lose the most (option sellers pay out least).",
  ATM: "At the money — the strike closest to the current spot price.",
  "Intrinsic": "Value if exercised now: spot − strike for calls, strike − spot for puts (never below zero).",
  "Time value": "Option price minus intrinsic value — what you pay for time and volatility. It decays to zero at expiry.",
  Breakeven: "Underlying price at expiry where the buyer neither gains nor loses: strike + premium for calls, strike − premium for puts.",
  Lot: "Contract size — the number of units in one lot. Premium × lot size = cost of one lot.",
  DTE: "Days to expiry (expiry assumed at 15:30 IST).",
};

/** Small ⓘ button that reveals an explanation (hover or tap). */
export function Info({ term, text, place = "top" }: { term: string; text?: string; place?: "top" | "bottom" | "left" }) {
  const [open, setOpen] = useState(false);
  const body = text ?? GLOSSARY[term];
  if (!body) return null;
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        aria-label={`What is ${term}?`}
        aria-expanded={open}
        className="ml-1 grid h-3.5 w-3.5 place-items-center rounded-full border border-muted/60 text-[9px] leading-none text-muted hover:border-accent hover:text-accent"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 w-60 rounded-lg border border-line bg-panel p-2.5 text-left text-[11px] font-normal normal-case leading-4 tracking-normal text-soft shadow-xl ${
            place === "bottom" ? "left-1/2 top-full mt-1.5 -translate-x-1/2" : place === "left" ? "bottom-full right-0 mb-1.5" : "bottom-full left-1/2 mb-1.5 -translate-x-1/2"
          }`}
        >
          <strong className="text-white">{term}.</strong> {body}
        </span>
      )}
    </span>
  );
}
