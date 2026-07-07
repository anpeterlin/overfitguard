"""
LAB 2 — The four defenses on a real strategy.  (Companion to Chapter 2.)

You will build an honest, ordinary strategy — a moving-average crossover on the bundled price series —
and put it through all four defenses at once. No cheating, no cherry-picking: just the workflow you
should run on every strategy before you believe it.

Run:  python lab2_four_defenses.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

from overfitguard import validate

HERE = Path(__file__).parent
COST_BPS = 2.0  # round-trip cost per trade, in basis points (Defense 4: subtract the friction)

prices = pd.read_csv(HERE / "data" / "prices.csv", parse_dates=["date"]).set_index("date")["close"]
ret = prices.pct_change().fillna(0.0)

# A plain 20/100 moving-average crossover: long when fast>slow, flat otherwise. Signal uses only past
# data (shifted by 1 day) — no look-ahead.
fast, slow = prices.rolling(20).mean(), prices.rolling(100).mean()
position = (fast > slow).astype(float).shift(1).fillna(0.0)

# Defense 4 — costs: charge COST_BPS whenever the position changes (a trade).
trades = position.diff().abs().fillna(0.0)
strategy_returns = position * ret - trades * (COST_BPS / 10_000.0)

buy_and_hold = ret  # the honest benchmark (Defense: beat THIS, not cash)

# Defenses 1–3 in one call: sealed holdout (OOS), Deflated Sharpe (multiplicity), benchmark.
# We tried ~2 lookbacks x a few thresholds while building this — call it 8 honest trials.
result = validate(strategy_returns, n_trials=8, benchmark=buy_and_hold)

print("20/100 moving-average crossover, net of 2bp/trade:\n")
print(result.report())
print(f"\nBuy-and-hold Sharpe over the same window: {result.benchmark_sharpe:.2f}")
print("\nTry it yourself: change `fast`/`slow`, raise `n_trials` to the number of combos you TRY,\n"
      "and watch how quickly a tuned crossover stops beating the honest benchmark out-of-sample.")
