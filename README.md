# Polymarket NVIDIA CEO Forecast

Entry for the make.fun competition **polymarket-nvidia-ceo-forecast-01**:
forecast Polymarket's next NVIDIA CEO prices minute by minute, 4 hours ahead.

## Model

`main.ts` (Node 22, standard library only) reads a case from
`/input/<id>.in` and writes `/output/<id>.out` with 5 quantiles
(5%, 25%, 50%, 75%, 95%) of each market's Yes price for the 240 minutes
after the checkpoint.

- Per-market sigma from the last 360 minutes of 1-minute returns
  (jumps |r| > 0.02 excluded, floored 0.0002, capped 0.005).
- Median = last price pulled 30% toward x/S, where S is the sum of all
  markets' last prices (the probabilities must sum to 1).
- Spread: q_tau(h) = clamp(med + z_tau * sigma * h^0.45, 0, 1).

Practice pinball loss 0.276757 vs the house persistence baseline's
0.363589 (-23.9%).

## Entrypoint

`main.ts` is the entrypoint. No network, deterministic, stdlib only.
