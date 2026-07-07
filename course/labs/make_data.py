"""
Regenerate the bundled lab datasets — deterministic, no downloads, no API keys.

Run:  python make_data.py   (writes CSVs into ./data/)

Everything the labs use is synthetic but *realistic* (drift, fat tails, a mild regime shift, and a
buried real edge among noise), so the exercises are turnkey and reproducible. Swap in your own real
data anytime — the labs only need a returns series or a price series.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)
DAYS = 3000  # ~12 trading years
DATES = pd.bdate_range("2013-01-02", periods=DAYS)


def _fat_tailed(rng, mu, sigma, n):
    """Daily returns with a realistic fat tail (Student-t, 5 dof), mean mu, std ~sigma."""
    t = rng.standard_t(5, n) / np.sqrt(5 / 3)  # rescale so unit-ish variance
    return mu + sigma * t


def main() -> None:
    rng = np.random.default_rng(20260705)

    # 1) A benchmark "index" price series (total return) — the honest yardstick for the labs.
    idx = _fat_tailed(rng, 0.0004, 0.011, DAYS)                 # ~10%/yr, ~17.5% vol
    idx[1200:1320] -= 0.004                                      # a stylised drawdown mid-sample
    prices = 100 * np.cumprod(1 + idx)
    pd.DataFrame({"date": DATES, "close": prices}).to_csv(DATA / "prices.csv", index=False)

    # 2) "Your strategy" for the capstone: looks great in-sample, quietly dies out-of-sample — the most
    #    common real failure mode. Strong drift in the first 65%, pure noise afterwards.
    cut = int(DAYS * 0.65)
    strat = np.empty(DAYS)
    strat[:cut] = _fat_tailed(rng, 0.0011, 0.009, cut)          # ~1.9 Sharpe in-sample
    strat[cut:] = _fat_tailed(rng, -0.0002, 0.009, DAYS - cut)  # dead (slightly negative) out-of-sample
    pd.DataFrame({"date": DATES, "returns": strat}).to_csv(DATA / "your_strategy.csv", index=False)

    # 3) A whole search: 250 candidate strategies. 249 are pure noise; ONE has a genuine, persistent
    #    edge. The screener should find the real one and reject a run where all 250 are noise.
    K = 250
    cand = _fat_tailed(rng, 0.0, 0.010, (K, DAYS))
    cand[7] = _fat_tailed(rng, 0.0009, 0.009, DAYS)             # the needle in the haystack (col cfg_007)
    frame = pd.DataFrame(cand.T, columns=[f"cfg_{i:03d}" for i in range(K)])
    frame.insert(0, "date", DATES)
    # Round to keep the (250-column) file lean — it is generated, not committed to the repo.
    frame.to_csv(DATA / "candidates.csv", index=False, float_format="%.5g")

    print(f"Wrote {DATA/'prices.csv'}, {DATA/'your_strategy.csv'}, {DATA/'candidates.csv'}")
    print(f"  prices: {DAYS} days | your_strategy: {DAYS} days | candidates: {K} columns")


if __name__ == "__main__":
    main()
