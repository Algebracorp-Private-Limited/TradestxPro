# Indicator catalog (122 built-ins)

Every built-in indicator is available on any chart (`chart.addIndicator(id, params)`), evaluated
incrementally and exactly (see [incremental-indicators.md](incremental-indicators.md)), and
described by metadata in its definition (`definition().meta`):

| Field | Meaning |
|---|---|
| `formula` | The exact formula and conventions used |
| `incremental` | `"exact"` for all 122 |
| `missing` | How gaps / NaN inputs are treated (gaps are removed from the input; warm-up yields NaN) |
| `conventions` | Choices where definitions differ between sources (population vs sample σ, seeding …) |
| `limitations` | Known limits |
| `repaint` | Present when past values can change after the fact (and why) |
| `requires` | Data beyond OHLC: `volume`, `time` (session/period resets), `benchmark` |

## Finding indicators

```ts
chart.searchIndicators({ text: "kaufman" });            // matches id, name and description
chart.searchIndicators({ category: "Volatility" });
chart.searchIndicators({ requires: "volume" });
chart.searchIndicators({ param: "length" });
chart.indicatorCompatibility("vwap");                     // { ok, reasons }: e.g. "needs volume, and this data has none"
```

## Requirements

* **volume** (18 indicators): `indicatorCompatibility` reports data without volume (e.g. an
  index). On price-based chart types they are hidden and listed in `getDerivedInfo().hidden`.
* **time** (VWAP, anchored VWAP, pivots family, previous high/low, opening range): reset by
  session/day/week/month using the bar times (intraday detection from the data).
* **benchmark** (`correl`, `covar`, `beta`, `alpha`): `addIndicator` throws `MISSING_INPUT` until
  `chart.setBenchmarkSeries(series)` is called (no benchmark data is assumed). The benchmark is
  aligned to the bars by time; missing benchmark values are NaN (never filled).

## Repainting and delayed indicators

Five indicators carry a `meta.repaint` note (shown in the catalog below):

* **ZigZag**: `confirmed` changes only when a swing is confirmed (never rewritten); `provisional`
  shows the current leg's extreme and may still move.
* **Opening range**: values inside the first N minutes are provisional while the range forms; they
  never change after the window.
* **Fractals, Swings**: never repaint; they are **delayed** (a fractal appears on the bar that
  confirms it, `n` / `right` bars later).
* **Ichimoku**: projected spans occupy future slots without candles; Chikou is a lagging display of
  past closes.

All other indicators are causal: the value at bar *i* depends only on bars ≤ *i*.

## Validation

* `tests/xchart-catalog.test.ts`: 91 natives against independent reference implementations, 9 by
  identities, streaming ≡ full for all 100 natives; parameter validation; gaps; requirements.
* `tests/xchart-incremental.test.ts`: the 22 originals bitwise against `lib/ta`.
* Hurst: directional check only (weaker; reported as a limitation).

## Catalog

Generated from the definitions (formula column = `meta.formula`).

### Trend (25)

| id | Name | Pane | Parameters (default) | Needs | Formula / notes |
|---|---|---|---|---|---|
| `sma` | Simple Moving Average | overlay | length=20, source=close | — | SMA = Σx/n over the last n values. |
| `ema` | Exponential Moving Average | overlay | length=20, source=close | — | EMA = α·x + (1 − α)·EMA[1], α = 2/(n+1), seeded with the SMA of the first n values. |
| `wma` | Weighted Moving Average | overlay | length=20, source=close | — | WMA = Σ (n − k)·x[k] / (n(n+1)/2), k = 0 newest. |
| `hma` | Hull Moving Average | overlay | length=21, source=close | — | HMA = WMA(2·WMA(x, n/2) − WMA(x, n), √n). |
| `supertrend` | Supertrend | overlay | length=10, mult=3 | — | Bands = hl2 ± m·ATR(n) with trailing rules; the line follows the lower band in an uptrend and the upper band in a downtrend; direction flips when the close crosses the active band. |
| `psar` | Parabolic SAR | overlay | step=0.02, max=0.2 | — | SAR = SAR[1] + AF·(EP − SAR[1]); AF starts at step, +step on each new extreme, capped at max; reverses when price crosses the SAR. |
| `ichimoku` | Ichimoku Cloud | overlay | conv=9, base=26, spanB=52, disp=26, chikou=false | — | Tenkan/Kijun/Span B = (HH + LL)/2 over 9/26/52; Span A = (Tenkan + Kijun)/2; spans plotted displacement − 1 bars ahead; Chikou = close plotted displacement − 1 bars back. **Repaint:** Projected spans occupy future slots without candles; Chikou is a lagging display of past closes. |
| `adx` | ADX / DMI | separate | length=14 | — | ±DI = 100·RMA(±DM)/RMA(TR); DX = 100·\|+DI − −DI\|/(+DI + −DI); ADX = RMA(DX). |
| `dema` | Double Exponential Moving Average | overlay | length=20, source=close | — | DEMA = 2·EMA(x,n) − EMA(EMA(x,n),n); EMAs seeded with an SMA of the first n values. |
| `tema` | Triple Exponential Moving Average | overlay | length=20, source=close | — | TEMA = 3·E1 − 3·E2 + E3, E1 = EMA(x,n), E2 = EMA(E1,n), E3 = EMA(E2,n). |
| `kama` | Kaufman Adaptive Moving Average | overlay | length=10, fast=2, slow=30, source=close | — | ER = \|x − x[n]\| / Σ\|Δx\| (n bars); SC = (ER·(2/(fast+1) − 2/(slow+1)) + 2/(slow+1))²; KAMA = KAMA[1] + SC·(x − KAMA[1]). |
| `alma` | Arnaud Legoux Moving Average | overlay | length=9, offset=0.85, sigma=6, source=close | — | w_k = exp(−(k − m)² / (2s²)), m = offset·(n−1), s = n/σ, k = 0 (oldest) … n−1; ALMA = Σ w_k·x_k / Σ w_k. |
| `t3` | Tillson T3 Moving Average | overlay | length=5, vfactor=0.7, source=close | — | e1…e6 = chained EMA(n); T3 = c1·e6 + c2·e5 + c3·e4 + c4·e3 with c1 = −v³, c2 = 3v² + 3v³, c3 = −6v² − 3v − 3v³, c4 = 1 + 3v + v³ + 3v². |
| `trima` | Triangular Moving Average | overlay | length=20, source=close | — | TRIMA = SMA(SMA(x, ⌈n/2⌉), ⌊n/2⌋ + 1). |
| `zlema` | Zero-Lag EMA | overlay | length=20, source=close | — | lag = ⌊(n−1)/2⌋; ZLEMA = EMA(x + (x − x[lag]), n). |
| `vidya` | Variable Index Dynamic Average | overlay | length=14, cmo=9, source=close | — | α = 2/(n+1); k = \|CMO(x, m)\|/100; VIDYA = α·k·x + (1 − α·k)·VIDYA[1]. |
| `mcginley` | McGinley Dynamic | overlay | length=14, source=close | — | MD = MD[1] + (x − MD[1]) / (n · (x / MD[1])⁴); seeded with EMA(x, n) at its first value. |
| `aroon` | Aroon | separate | length=14 | — | Up = 100·(n − bars since highest high of the last n+1 bars)/n; Down likewise with the lowest low. |
| `aroonosc` | Aroon Oscillator | separate | length=14 | — | Aroon Up − Aroon Down (see Aroon). |
| `vortex` | Vortex Indicator | separate | length=14 | — | VM+ = \|H − L[1]\|, VM− = \|L − H[1]\|; VI± = Σ VM± / Σ TR over n bars. |
| `ckstop` | Chande Kroll Stop | overlay | p=10, x=1, q=9 | — | fh = HH(p) − x·ATR(p), fl = LL(p) + x·ATR(p); stop short = HH(fh, q); stop long = LL(fl, q). |
| `chandelier` | Chandelier Exit | overlay | length=22, mult=3 | — | Long = HH(n) − m·ATR(n); Short = LL(n) + m·ATR(n). |
| `trix` | TRIX | separate | length=15, source=close | — | E3 = EMA(EMA(EMA(x,n),n),n); TRIX = 100·(E3 − E3[1]) / E3[1]. |
| `envelopes` | Moving Average Envelopes | overlay | length=20, percent=2.5, source=close | — | Mid = SMA(x,n); Upper = Mid·(1 + p/100); Lower = Mid·(1 − p/100). |
| `smma` | Smoothed Moving Average (RMA) | overlay | length=14, source=close | — | SMMA = (SMMA[1]·(n−1) + x)/n, seeded with SMA(x,n). |

### Momentum (24)

| id | Name | Pane | Parameters (default) | Needs | Formula / notes |
|---|---|---|---|---|---|
| `rsi` | Relative Strength Index | separate | length=14, ob=70, os=30, zones=true, band=true, bg=false, source=close | — | RSI = 100 − 100/(1 + RMA(up,n)/RMA(down,n)), Wilder smoothing. |
| `macd` | MACD | separate | fast=12, slow=26, signal=9, source=close | — | MACD = EMA(f) − EMA(s); Signal = EMA(MACD, k); Hist = MACD − Signal. |
| `stoch` | Stochastic | separate | k=14, smooth=3, d=3 | — | %K raw = 100·(C − LL)/(HH − LL) (50 when HH = LL); %K = SMA(raw, smooth); %D = SMA(%K, d). |
| `cci` | Commodity Channel Index | separate | length=20 | — | CCI = (TP − SMA(TP))/(0.015·mean absolute deviation), TP = (H+L+C)/3. |
| `willr` | Williams %R | separate | length=14 | — | %R = −100·(HH − C)/(HH − LL) (−50 when HH = LL). |
| `roc` | Rate of Change | separate | length=12, source=close | — | ROC = 100·(x − x[n])/x[n]. |
| `stochrsi` | Stochastic RSI | separate | rsi=14, stoch=14, k=3, d=3, source=close | — | S = 100·(RSI − LL(RSI,m))/(HH(RSI,m) − LL(RSI,m)) (50 when the range is 0); %K = SMA(S,k); %D = SMA(%K,d). |
| `mom` | Momentum | separate | length=10, source=close | — | MOM = x − x[n]. |
| `uo` | Ultimate Oscillator | separate | fast=7, mid=14, slow=28 | — | BP = C − min(L, C[1]); TR = max(H, C[1]) − min(L, C[1]); A_k = ΣBP/ΣTR (k bars); UO = 100·(4A₁ + 2A₂ + A₃)/7. |
| `ao` | Awesome Oscillator | separate | fast=5, slow=34 | — | AO = SMA(hl2, 5) − SMA(hl2, 34). |
| `ac` | Accelerator Oscillator | separate | fast=5, slow=34, signal=5 | — | AC = AO − SMA(AO, 5). |
| `tsi` | True Strength Index | separate | long=25, short=13, signal=13, source=close | — | m = x − x[1]; TSI = 100·EMA(EMA(m,r),s)/EMA(EMA(\|m\|,r),s); Signal = EMA(TSI, k). |
| `rvgi` | Relative Vigor Index | separate | length=10 | — | num = (co + 2co[1] + 2co[2] + co[3])/6, co = C − O; den likewise with H − L; RVI = Σnum/Σden (n); Signal = (RVI + 2RVI[1] + 2RVI[2] + RVI[3])/6. |
| `cmo` | Chande Momentum Oscillator | separate | length=9, source=close | — | CMO = 100·(Σup − Σdown)/(Σup + Σdown) over n changes (0 when there is no movement). |
| `dpo` | Detrended Price Oscillator | separate | length=20, source=close | — | DPO = x[⌊n/2⌋+1] − SMA(x, n). Limit: The centred textbook DPO looks ahead; this version is shifted to avoid that. |
| `ppo` | Percentage Price Oscillator | separate | fast=12, slow=26, signal=9, source=close | — | PPO = 100·(EMA(x,f) − EMA(x,s))/EMA(x,s); Signal = EMA(PPO, k); Hist = PPO − Signal. |
| `coppock` | Coppock Curve | separate | wma=10, long=14, short=11, source=close | — | Coppock = WMA(ROC(x, long) + ROC(x, short), w). |
| `fisher` | Fisher Transform | separate | length=9 | — | v = 0.66·((hl2 − LL)/(HH − LL) − 0.5) + 0.67·v[1], clamped to ±0.999; F = 0.5·ln((1+v)/(1−v)) + 0.5·F[1]; Trigger = F[1]. |
| `kst` | Know Sure Thing | separate | signal=9, source=close | — | KST = SMA(ROC10,10) + 2·SMA(ROC15,10) + 3·SMA(ROC20,10) + 4·SMA(ROC30,15); Signal = SMA(KST, 9). |
| `stc` | Schaff Trend Cycle | separate | fast=23, slow=50, cycle=10, factor=0.5, source=close | — | MACD = EMA(f) − EMA(s); F1 = stoch(MACD, c), PF = PF[1] + f·(F1 − PF[1]); F2 = stoch(PF, c); STC = STC[1] + f·(F2 − STC[1]). |
| `bop` | Balance of Power | separate | smooth=14 | — | BOP = SMA((C − O)/(H − L), k); a bar with H = L contributes 0. |
| `elderray` | Elder Ray Index | separate | length=13 | — | Bull = H − EMA(C, n); Bear = L − EMA(C, n). |
| `crsi` | Connors RSI | separate | rsi=3, streak=2, rank=100 | — | CRSI = (RSI(C, a) + RSI(streak, b) + PercentRank(ROC(C,1), c))/3; streak = consecutive up (+) / down (−) closes, 0 when unchanged; PercentRank = % of the previous c values below the current one. |
| `demarker` | DeMarker | separate | length=14 | — | DeMax = max(H − H[1], 0), DeMin = max(L[1] − L, 0); DeM = SMA(DeMax)/(SMA(DeMax) + SMA(DeMin)) (0.5 when both are 0). |

### Volatility (18)

| id | Name | Pane | Parameters (default) | Needs | Formula / notes |
|---|---|---|---|---|---|
| `bb` | Bollinger Bands | overlay | length=20, mult=2, source=close | — | Mid = SMA(x,n); Upper/Lower = Mid ± m·σ (population σ). |
| `keltner` | Keltner Channels | overlay | length=20, mult=2, atr=10 | — | Mid = EMA(C,n); Upper/Lower = Mid ± m·ATR(atr) (Wilder). |
| `donchian` | Donchian Channels | overlay | length=20 | — | Upper = HH(H,n); Lower = LL(L,n); Mid = (Upper + Lower)/2. |
| `atr` | Average True Range | separate | length=14 | — | ATR = RMA(TR, n), TR = max(H − L, \|H − C[1]\|, \|L − C[1]\|). |
| `bbw` | Bollinger Bandwidth | separate | length=20, mult=2, source=close | — | BBW = (Upper − Lower)/Middle, bands = SMA ± m·σ (population σ). |
| `bbpb` | Bollinger %B | separate | length=20, mult=2, source=close | — | %B = (x − Lower)/(Upper − Lower) (NaN when the bands coincide). |
| `natr` | Normalized ATR | separate | length=14 | — | NATR = 100·ATR(n)/C (Wilder ATR). |
| `hv` | Historical Volatility | separate | length=20, periods=252 | — | r = ln(C/C[1]); HV = sd(r, n; sample, n−1)·√P·100. |
| `parkinson` | Parkinson Volatility | separate | length=20, periods=252 | — | σ² = Σ ln(H/L)² / (4·n·ln 2); annualised σ·√P·100. |
| `garmanklass` | Garman-Klass Volatility | separate | length=20, periods=252 | — | σ² = (1/n)·Σ[0.5·ln(H/L)² − (2 ln 2 − 1)·ln(C/O)²]; annualised. Limit: Assumes no drift and no opening gaps. |
| `rogerssatchell` | Rogers-Satchell Volatility | separate | length=20, periods=252 | — | σ² = (1/n)·Σ[ln(H/C)·ln(H/O) + ln(L/C)·ln(L/O)]; annualised. |
| `yangzhang` | Yang-Zhang Volatility | separate | length=20, periods=252 | — | σ² = σo² + k·σc² + (1 − k)·σrs², k = 0.34/(1.34 + (n+1)/(n−1)); σo² = sample var of ln(O/C[1]); σc² = sample var of ln(C/O); σrs² = mean RS term. |
| `stddev` | Standard Deviation | separate | length=20, source=close | — | σ = √(Σ(x − mean)²/n) (population, same convention as Bollinger Bands). |
| `chop` | Choppiness Index | separate | length=14 | — | CHOP = 100·log10(Σ TR / (HH − LL)) / log10(n) over n bars (TR of the first bar = H − L). |
| `massindex` | Mass Index | separate | ema=9, length=25 | — | R = EMA(H − L, 9)/EMA(EMA(H − L, 9), 9); MI = Σ R over 25 bars. |
| `ulcer` | Ulcer Index | separate | length=14, source=close | — | D = 100·(x − HH(x,n))/HH(x,n); UI = √(Σ D²/n). |
| `chaikinvol` | Chaikin Volatility | separate | ema=10, roc=10 | — | E = EMA(H − L, n); CV = 100·(E − E[m])/E[m]. |
| `rvol` | Relative Volatility Index | separate | std=10, length=14, source=close | — | u = σ(x,10) if x > x[1] else 0; d = σ(x,10) if x < x[1] else 0; RVI = 100·EMA(u,14)/(EMA(u,14) + EMA(d,14)). |

### Volume (18)

| id | Name | Pane | Parameters (default) | Needs | Formula / notes |
|---|---|---|---|---|---|
| `vwap` | VWAP | overlay | hideDaily=false, anchor=Session, source=(H + L + C)/3, offset=0, bandsMode=Standard deviation, band1=true, mult1=1, band2=true, mult2=2, band3=true, mult3=3 | volume, time | VWAP = Σ(src·V)/ΣV within each anchor period (IST session/week/month); bands = VWAP ± m·σ_vw or ± m%. |
| `mfi` | Money Flow Index | separate | length=14 | volume | MFI = 100 − 100/(1 + Σpositive flow/Σnegative flow), flow = TP·V. |
| `obv` | On-Balance Volume | separate | — | volume | OBV = Σ ±V by close direction (0 when unchanged). Limit: Cumulative: the level depends on where the history starts. |
| `volume` | Volume | separate | length=20 | volume | Volume histogram and SMA(V, n). Limit: Shows nothing when no bar has volume (e.g. index data). |
| `avwap` | Anchored VWAP | overlay | anchor=0 | volume, time | AVWAP = Σ(hlc3·V)/ΣV from the first bar at or after the anchor; the typical price while ΣV = 0. |
| `cmf` | Chaikin Money Flow | separate | length=20 | volume | MFM = ((C − L) − (H − C))/(H − L) (0 when H = L); CMF = Σ(MFM·V)/ΣV over n bars (NaN when ΣV = 0). |
| `adl` | Accumulation/Distribution | separate | — | volume | A/D = Σ MFM·V since the first bar. Limit: Cumulative: the level depends on where the history starts. |
| `chaikinosc` | Chaikin Oscillator | separate | fast=3, slow=10 | volume | CO = EMA(A/D, 3) − EMA(A/D, 10). |
| `fi` | Force Index | separate | length=13 | volume | FI = EMA((C − C[1])·V, n). |
| `eom` | Ease of Movement | separate | length=14, divisor=10000 | volume | EMV = (hl2 − hl2[1]) / ((V/div)/(H − L)); EOM = SMA(EMV, n). A bar with V = 0 or H = L gives 0. |
| `volosc` | Volume Oscillator | separate | fast=5, slow=10 | volume | VO = 100·(EMA(V,f) − EMA(V,s))/EMA(V,s). |
| `pvo` | Percentage Volume Oscillator | separate | fast=12, slow=26, signal=9 | volume | PVO = 100·(EMA(V,12) − EMA(V,26))/EMA(V,26); Signal = EMA(PVO,9); Hist = PVO − Signal. |
| `pvt` | Price Volume Trend | separate | — | volume | PVT = Σ V·(C − C[1])/C[1] (first bar contributes 0). |
| `nvi` | Negative Volume Index | separate | start=1000 | volume | NVI = NVI[1]·(1 + (C − C[1])/C[1]) when V < V[1], else NVI[1]; starts at 1000. |
| `pvi` | Positive Volume Index | separate | start=1000 | volume | PVI = PVI[1]·(1 + (C − C[1])/C[1]) when V > V[1], else PVI[1]; starts at 1000. |
| `kvo` | Klinger Volume Oscillator | separate | fast=34, slow=55, signal=13 | volume | trend = +1 if hlc3 > hlc3[1] else −1; dm = H − L; cm = cm[1] + dm if trend = trend[1] else dm[1] + dm; VF = V·\|2·dm/cm − 1\|·trend·100; KVO = EMA(VF,34) − EMA(VF,55); Signal = EMA(KVO,13). |
| `vroc` | Volume Rate of Change | separate | length=14 | volume | VROC = 100·(V − V[n])/V[n] (NaN when V[n] = 0). |
| `vwma` | Volume-Weighted Moving Average | overlay | length=20, source=close | volume | VWMA = Σ(x·V)/ΣV over n bars (NaN when ΣV = 0). |

### Statistics (23)

| id | Name | Pane | Parameters (default) | Needs | Formula / notes |
|---|---|---|---|---|---|
| `linreg` | Linear Regression | overlay | length=20, source=close | — | Fit y = a + b·t to the last n values (t = 0 oldest … n−1 current); LinReg = a + b·(n−1). |
| `lrslope` | Linear Regression Slope | separate | length=20, source=close | — | b = (nΣty − ΣtΣy)/(nΣt² − (Σt)²). |
| `lrintercept` | Linear Regression Intercept | overlay | length=20, source=close | — | a = (Σy − b·Σt)/n with t = 0 at the oldest bar. |
| `lrchannel` | Linear Regression Channel | overlay | length=50, mult=2, source=close | — | Mid = LinReg; σ = √(Σresidual²/n); Upper/Lower = Mid ± k·σ. |
| `r2` | Coefficient of Determination | separate | length=20, source=close | — | R² = 1 − SSres/SStot (NaN when SStot = 0). |
| `stderr` | Standard Error of Regression | separate | length=20, source=close | — | SE = √(SSres/(n − 2)). |
| `variance` | Rolling Variance | separate | length=20, source=close | — | Var = Σ(x − mean)²/n (population). |
| `zscore` | Rolling Z-Score | separate | length=20, source=close | — | Z = (x − mean)/σ, population σ over n bars (NaN when σ = 0). |
| `median` | Rolling Median | overlay | length=20, source=close | — | Middle value of the sorted window (mean of the two middle values for even n). |
| `percentile` | Rolling Percentile | overlay | length=20, q=90, source=close | — | Linear interpolation between order statistics at rank (n − 1)·q/100. |
| `skew` | Rolling Skewness | separate | length=30, source=close | — | g1 = m3/m2^1.5 (population moments; NaN when m2 = 0). |
| `kurtosis` | Rolling Kurtosis | separate | length=30, source=close | — | g2 = m4/m2² − 3 (population moments; NaN when m2 = 0). |
| `correl` | Rolling Correlation | separate | length=20, mode=returns, source=close | benchmark | ρ = cov(a, b)/(σa·σb) over n bars of returns (or prices). |
| `covar` | Rolling Covariance | separate | length=20, mode=returns, source=close | benchmark | cov = Σ(a − ā)(b − b̄)/(n − 1). |
| `beta` | Rolling Beta | separate | length=60, source=close | benchmark | β = cov(r, rb)/var(rb) over n returns. |
| `alpha` | Rolling Alpha (Jensen) | separate | length=60, rf=0, periods=252, source=close | benchmark | α = [mean(r − rf/P) − β·mean(rb − rf/P)]·P·100. |
| `maxdd` | Rolling Maximum Drawdown | separate | length=252, source=close | — | MDD = min over the window of 100·(x_t / max_{s≤t} x_s − 1), peaks taken inside the window. |
| `sharpe` | Rolling Sharpe Ratio | separate | length=252, rf=0, periods=252, source=close | — | S = mean(r − rf/P)/sd(r)·√P (sample sd, n − 1). |
| `sortino` | Rolling Sortino Ratio | separate | length=252, rf=0, periods=252, source=close | — | So = mean(r − rf/P)/DD·√P, DD = √(Σ min(r − rf/P, 0)²/n). |
| `hurst` | Rolling Hurst Exponent | separate | length=128, source=close | — | For chunk sizes s = 8, 16, 32, … ≤ n/2: average R/S over non-overlapping chunks of the window's log returns; H = slope of log(R/S) on log(s). Limit: Classic R/S without small-sample (Anis-Lloyd) correction; noisy for short windows. |
| `autocorr` | Rolling Autocorrelation | separate | length=30, lag=1, source=close | — | Pearson correlation of (r_t, r_{t−L}) over the last n pairs of returns. |
| `er` | Efficiency Ratio | separate | length=10, source=close | — | ER = \|x − x[n]\| / Σ\|x_k − x_{k−1}\| over n changes (0 when there is no movement). |
| `meandev` | Mean Absolute Deviation | separate | length=20, source=close | — | MAD = Σ\|x − mean\|/n. |

### Structure (14)

| id | Name | Pane | Parameters (default) | Needs | Formula / notes |
|---|---|---|---|---|---|
| `pivots` | Standard Pivot Points | overlay | period=day | time | P = (H+L+C)/3; R1 = 2P − L; S1 = 2P − H; R2 = P + (H − L); S2 = P − (H − L); R3 = H + 2(P − L); S3 = L − 2(H − P). |
| `fibpivots` | Fibonacci Pivot Points | overlay | period=day | time | P = (H+L+C)/3; R/Sₖ = P ± {0.382, 0.618, 1}·(H − L). |
| `camarilla` | Camarilla Pivot Points | overlay | period=day | time | R/Sₖ = C ± 1.1·(H − L)/{12, 6, 4, 2}; P = (H+L+C)/3. |
| `woodie` | Woodie Pivot Points | overlay | period=day | time | P = (H + L + 2C)/4; R1 = 2P − L; S1 = 2P − H; R2 = P + (H − L); S2 = P − (H − L). |
| `demark` | DeMark Pivot Points | overlay | period=day | time | X = 2H + L + C if C > O; H + 2L + C if C < O; H + L + 2C otherwise; P = X/4; R1 = X/2 − L; S1 = X/2 − H. |
| `cpr` | Central Pivot Range | overlay | period=day | time | Pivot = (H+L+C)/3; BC = (H+L)/2; TC = 2·Pivot − BC. |
| `prevhl` | Previous Period High/Low | overlay | period=day | time | Previous completed period's high, low and close. |
| `highesthigh` | Highest High | overlay | length=20 | — | HH = max(H, n). |
| `lowestlow` | Lowest Low | overlay | length=20 | — | LL = min(L, n). |
| `pricechannel` | Price Channel | overlay | length=20 | — | Upper = max(H[1…n]); Lower = min(L[1…n]) — the current bar is excluded so a breakout can be seen. |
| `fractals` | Fractal Highs and Lows | overlay | bars=2 | — | A high H[n] strictly greater than the n highs on each side is a fractal high; shown at the current bar with value H[n]. Lows likewise. **Repaint:** Never repaints: a fractal appears only once the n bars after it exist, on the confirming bar. |
| `swings` | Swing Highs and Lows | overlay | left=5, right=5 | — | A bar is a swing high when its high exceeds the `left` highs before and the `right` highs after it; the level is carried forward from the confirming bar. **Repaint:** Never repaints: levels change only on the bar that confirms a new swing (`right` bars later). |
| `zigzag` | Zig Zag | overlay | deviation=5 | — | Tracks the running extreme of the current leg; a swing is confirmed when price reverses by the deviation % from that extreme. **Repaint:** The classic Zig Zag repaints its last leg. Here `confirmed` only changes when a swing is confirmed (never rewritten) and `provisional` shows the current leg's extreme, which may still move. |
| `openingrange` | Opening Range | overlay | minutes=15 | time | From the session's first bar until first-bar time + N minutes: running high/low (provisional while the range is forming); afterwards the final range is carried for the rest of the session. **Repaint:** Values during the first N minutes are provisional (the range is still forming); they never change once the window has passed. |
