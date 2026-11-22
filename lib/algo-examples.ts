// Worked strategy examples for the Algo Trading page. The strategy() / entry / exit syntax is the
// planned XScript strategy extension; indicator functions are the ones already live in XScript Lab.

export type AlgoExample = {
  id: string;
  name: string;
  market: string;
  timeframe: string;
  style: string;
  idea: string;
  rules: string[];
  code: string;
  risks: string[];
};

export const ALGO_EXAMPLES: AlgoExample[] = [
  {
    id: "ema-cross",
    name: "EMA crossover trend follower",
    market: "NSE stocks / NIFTY futures",
    timeframe: "15-minute or daily",
    style: "Trend following",
    idea: "Prices tend to keep moving in the direction of a new trend. When a fast average crosses above a slow one, momentum has turned up; when it crosses back below, the trend has likely ended.",
    rules: [
      "Buy when the 9 EMA crosses above the 21 EMA and price is above the 200 EMA (only trade with the bigger trend).",
      "Sell (exit) when the 9 EMA crosses back below the 21 EMA.",
      "Protective stop-loss 1.5% below entry; book profit at 3%.",
    ],
    code: `strategy("EMA Crossover", capital=100000, risk_per_trade=1)
fast = ema(close, 9)
slow = ema(close, 21)
trend_up = close > ema(close, 200)

entry_long(crossover(fast, slow) and trend_up)
exit_long(crossunder(fast, slow))
stop_loss(percent=1.5)
take_profit(percent=3)`,
    risks: ["Many small losses in sideways markets (whipsaws).", "Gaps at the open can jump past the stop-loss."],
  },
  {
    id: "rsi-reversion",
    name: "RSI pullback in an uptrend",
    market: "Large-cap NSE stocks",
    timeframe: "Daily",
    style: "Mean reversion",
    idea: "Strong stocks often dip briefly and recover. Buying when RSI is oversold — but only while the stock is still above its 200-day average — tries to catch those dips without fighting a downtrend.",
    rules: [
      "Buy when RSI(14) falls below 30 and close is above the 200 EMA.",
      "Exit when RSI(14) recovers above 55, or after 10 trading days, whichever comes first.",
      "Stop-loss at 2 × ATR(14) below entry.",
    ],
    code: `strategy("RSI Pullback", capital=200000, max_positions=5)
r = rsi(close, 14)
entry_long(r < 30 and close > ema(close, 200))
exit_long(r > 55)
exit_after_bars(10)
stop_loss(points=2 * atr(14))`,
    risks: ["A 'dip' can turn into a real breakdown — the stop-loss matters.", "Fewer trades, so results depend heavily on a handful of outcomes."],
  },
  {
    id: "orb",
    name: "Opening range breakout (ORB)",
    market: "Liquid NSE stocks, NIFTY / BANKNIFTY futures",
    timeframe: "5-minute, intraday only",
    style: "Breakout",
    idea: "The first 15 minutes set the day's early battle lines. A decisive move beyond that range, with volume, often continues for a while.",
    rules: [
      "Mark the high and low of 09:15–09:30.",
      "Buy if price closes above the range high with volume above its 20-bar average; short if it closes below the range low.",
      "Stop-loss at the other side of the range; square off everything at 15:15.",
    ],
    code: `strategy("ORB 15", capital=100000, intraday=true)
or_high = session_high("09:15", "09:30")
or_low  = session_low("09:15", "09:30")
vol_ok  = volume > sma(volume, 20)

entry_long(crossover(close, or_high) and vol_ok)
entry_short(crossunder(close, or_low) and vol_ok)
stop_loss(level_long=or_low, level_short=or_high)
square_off("15:15")`,
    risks: ["False breakouts are common on low-volume days.", "Slippage is larger at the open — backtests must include it."],
  },
  {
    id: "supertrend",
    name: "Supertrend with trailing stop",
    market: "NSE stocks / index futures",
    timeframe: "1-hour or daily",
    style: "Trend following",
    idea: "Supertrend flips when price moves more than a multiple of recent volatility (ATR) against the trend. It doubles as a natural trailing stop.",
    rules: [
      "Go long when Supertrend(10, 3) turns up; go short (futures only) when it turns down.",
      "The Supertrend line is the trailing stop — exit when it flips.",
      "Skip trades when ADX(14) is below 20 (no trend).",
    ],
    code: `strategy("Supertrend Trail", capital=150000)
dir = supertrend_dir(10, 3)
trending = adx(14) > 20

entry_long(dir == 1 and dir[1] == -1 and trending)
entry_short(dir == -1 and dir[1] == 1 and trending)
trail_stop(supertrend(10, 3))`,
    risks: ["Gives back part of the profit before the trailing stop triggers.", "Choppy, trendless periods cause repeated flips."],
  },
  {
    id: "short-straddle",
    name: "Index short straddle with stop-losses",
    market: "NIFTY / SENSEX weekly options",
    timeframe: "Intraday",
    style: "Options — premium selling",
    idea: "Option premiums lose value as time passes (theta decay). Selling an at-the-money call and put collects that premium, profiting if the index stays in a range.",
    rules: [
      "At 09:20 sell 1 lot ATM CE and 1 lot ATM PE of the nearest weekly expiry.",
      "Each leg has a 25% stop-loss on its premium; if one leg stops out, the other continues.",
      "Exit everything at 15:15, or if combined loss reaches ₹5,000 for the day.",
    ],
    code: `strategy("NIFTY Short Straddle", underlying="NIFTY", lots=1, intraday=true)
at_time("09:20"):
    sell(option(atm(), "CE", expiry="weekly"))
    sell(option(atm(), "PE", expiry="weekly"))
leg_stop_loss(percent=25)
max_daily_loss(5000)
square_off("15:15")`,
    risks: [
      "Losses on short options are theoretically unlimited on a sharp move.",
      "Needs margin; margin can rise suddenly on volatile days.",
      "Not suitable for beginners — please backtest and paper-trade first.",
    ],
  },
];

export const ALGO_FAQ: { q: string; a: string }[] = [
  {
    q: "What exactly is algo trading?",
    a: "Algorithmic trading means writing down your trading rules precisely — when to buy, when to sell, how much, where the stop-loss is — and letting software watch the market and act on those rules automatically. It removes hesitation and emotion, and lets you test an idea on years of past data before risking money.",
  },
  {
    q: "Do I need to know programming?",
    a: "No. You can start from ready-made templates and adjust numbers like the moving-average length or the stop-loss percentage. If you want more control, XScript — our trading language — reads almost like plain English, and you can already try it in XScript Lab on the chart page.",
  },
  {
    q: "Will TradestXPro hold my money or trade from its own account?",
    a: "Never. Orders will go only through your own broker account (ICICI Direct, Kotak, Dhan, Zerodha, Upstox, Angel One, Fyers…). Your funds stay with your broker. You can stop every strategy instantly with one kill switch.",
  },
  {
    q: "Is algo trading legal for retail traders in India?",
    a: "Yes, under SEBI's framework for retail algorithmic trading (2025). It requires algos to be registered with the exchange through a broker, orders to come from registered systems with proper risk controls, and providers to meet SEBI's requirements. We will switch on live algo trading only after completing these registrations — that is exactly why we're measuring interest first.",
  },
  {
    q: "Is profit guaranteed?",
    a: "No. No strategy, human or automated, guarantees profits, and a good backtest does not guarantee future results. Algo trading can lose money, sometimes quickly — especially with options and leverage. Start with backtesting and paper trading, and only risk money you can afford to lose.",
  },
  {
    q: "What happens after I join the waitlist?",
    a: "Nothing is charged and you're not committing to anything. When enough traders sign up, we'll complete the regulatory process and invite waitlist members first — with early-access pricing.",
  },
];
