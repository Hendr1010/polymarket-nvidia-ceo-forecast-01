// polymarket-nvidia-ceo-forecast-01 entry: forecasts each market's Yes price
// for the 240 minutes after the checkpoint, as five quantiles.
// Node 22, standard library only. Deterministic: two runs write the same bytes.
//
// Model (per market, per case; only prices up to the checkpoint are used):
//   x     = last price at the checkpoint
//   sigma = population std of the market's 1-minute returns over the last
//           360 minutes (6h), excluding jumps |r| > 0.02, floored at
//           0.0002 and capped at 0.005. (Fewer than 10 usable returns -> floor.)
//           The baseline's single 0.0025 is ~2x the recent jump-excluded vol
//           and ~4.5x the quiet vol, so it is too wide in quiet minutes and
//           too narrow for jumps; per-market recent sigma fixes both.
//   med   = x pulled 30% toward x / S, where S is the sum of all markets'
//           last prices in the case. The book sums to 0.81-1.09 in the
//           practice (not ~1), and the mispricing sits in 1-2 markets;
//           a mild shrink toward coherence helps the big markets that
//           dominate the loss. When the book is coherent (S ~ 1) it does
//           almost nothing.
//   q_tau(h) = clamp(med + z_tau * sigma * h^0.45, 0, 1), rounded to 6 decimals.
//           The spread grows like h^0.45, slightly slower than the random
//           walk's sqrt(h): prices mean-revert a little (lag-1 return
//           autocorrelation is slightly negative), so long-horizon spread
//           saturates.
// Practice loss (6 cases, pinball): baseline 0.363589, this model 0.276757 (-23.9%).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];

/** Minutes of recent history used for the per-market sigma. */
const SIGMA_WINDOW = 360;
/** 1-minute returns larger than this are jumps: excluded from sigma. */
const JUMP_CUT = 0.02;
/** Sigma floor / cap, in price units per (minute^0.45). */
const SIGMA_FLOOR = 0.0002;
const SIGMA_CAP = 0.005;
/** Horizon exponent of the spread (slightly below the random walk's 0.5). */
const ALPHA = 0.45;
/** Weight of the sum-to-one pull on the median. */
const SUM_W = 0.3;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** Population std of an array (divides by N, like Python's pstdev). */
function pstdev(xs: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / n;
  return Math.sqrt(v);
}

/** Per-market sigma from the last SIGMA_WINDOW minutes of 1-min returns. */
function marketSigma(prices: number[]): number {
  const ps = prices.slice(-(SIGMA_WINDOW + 1));
  const rets: number[] = [];
  for (let i = 1; i < ps.length; i++) {
    const r = (ps[i] as number) - (ps[i - 1] as number);
    if (Math.abs(r) <= JUMP_CUT) rets.push(r);
  }
  if (rets.length < 10) return SIGMA_FLOOR;
  const s = pstdev(rets);
  return Math.min(SIGMA_CAP, Math.max(SIGMA_FLOOR, s));
}

/** The forecast of one market: horizon rows of the five quantiles. */
function forecast(m: CaseMarket, horizon: number, caseSum: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  const sigma = marketSigma(m.prices);
  const med = caseSum > 0 ? (1 - SUM_W) * x + SUM_W * (x / caseSum) : x;
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const spread = sigma * Math.pow(h, ALPHA);
    rows.push(Z.map((z) => price6(med + z * spread)));
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const caseSum = c.markets.reduce((a, m) => a + (m.prices[m.prices.length - 1] as number), 0);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes, caseSum) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
