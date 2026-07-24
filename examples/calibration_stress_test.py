"""Calibration stress test: does OverfitGuard actually resist data-mined 'winners'?

The failure mode that ruins real traders: try many strategies on the same history, keep the
best-looking one, and deploy it — even when *none* of them has a real edge. This script simulates
exactly that and compares a naive rule ("annualized Sharpe > 1, ship it") against OverfitGuard's
deflated verdict. It is deterministic (fixed seed), so the numbers are reproducible.

Run:  python examples/calibration_stress_test.py
"""
from __future__ import annotations

import numpy as np

from overfitguard import validate

PPY = 252
N_WINNERS = 400        # how many "data-mined winners" we manufacture
POOL = 200             # strategies searched per winner (all pure noise, no edge)
N = 750                # periods per strategy
NAIVE_THRESHOLD = 1.0  # a common retail rule of thumb: annualized Sharpe > 1 -> trade it


def _annualized_sharpe(r: np.ndarray) -> float:
    sd = r.std(ddof=1)
    return 0.0 if sd == 0 else r.mean() / sd * np.sqrt(PPY)


def _data_mined_winner(rng: np.random.Generator) -> tuple[np.ndarray, float]:
    """Return the best-in-sample series out of POOL pure-noise strategies (there is NO real edge)."""
    best_r, best_s = None, -np.inf
    for _ in range(POOL):
        r = rng.normal(0.0, 0.01, N)  # zero mean -> no edge, only luck
        s = _annualized_sharpe(r)
        if s > best_s:
            best_s, best_r = s, r
    return best_r, best_s


def main() -> None:
    rng = np.random.default_rng(20260717)
    naive_greenlit = 0
    og_blessed = 0
    for _ in range(N_WINNERS):
        r, s = _data_mined_winner(rng)
        if s > NAIVE_THRESHOLD:
            naive_greenlit += 1
        # We honestly tell OverfitGuard how many strategies were tried (POOL) — that is the whole point.
        if validate(r, n_trials=POOL, periods_per_year=PPY).verdict == "LIKELY_REAL":
            og_blessed += 1

    print(f"Manufactured {N_WINNERS} 'winners', each the best of {POOL} pure-noise strategies (no real edge).")
    print(f"  Naive rule (annualized Sharpe > {NAIVE_THRESHOLD:.0f}) green-lit : "
          f"{naive_greenlit}/{N_WINNERS} ({naive_greenlit / N_WINNERS * 100:.0f}%)  <- money lost")
    print(f"  OverfitGuard blessed as LIKELY_REAL              : "
          f"{og_blessed}/{N_WINNERS} ({og_blessed / N_WINNERS * 100:.1f}%)  <- honest")


if __name__ == "__main__":
    main()
