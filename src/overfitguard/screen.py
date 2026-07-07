"""
Multi-candidate screening — White's Reality Check (Sullivan, Timmermann & White; White 2000).

`validate()` judges ONE strategy after the fact, deflating by a trial count you report honestly.
`screen()` judges a WHOLE search at once: given the return series of every candidate you tried, it asks
whether the *best* one is genuinely good, or merely the luckiest of many. It uses the actual candidates
(and their cross-correlation), so it does not rely on you counting trials correctly — it counts them
for you and models how good "the best of these" would look if none of them had any edge at all.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

_TRADING_DAYS = 252


@dataclass(frozen=True)
class ScreenResult:
    verdict: str                     # BEST_IS_SIGNIFICANT / NO_STRATEGY_BEATS_LUCK / INSUFFICIENT_DATA
    best_name: str
    reality_check_p_value: float     # P(the best is this good by luck | the whole search)
    best_mean_annual: float          # annualised mean return of the winner
    best_sharpe_annual: float
    n_candidates: int
    n_periods: int
    n_bootstrap: int
    block: int

    def report(self) -> str:
        ok = self.reality_check_p_value < 0.05
        return "\n".join([
            "=== OverfitGuard — search screen (White's Reality Check) ===",
            f"VERDICT: {self.verdict}",
            f"Best candidate: {self.best_name}  (annual return {self.best_mean_annual * 100:.1f}%, "
            f"Sharpe {self.best_sharpe_annual:.2f})",
            f"Reality-Check p-value: {self.reality_check_p_value:.3f}  "
            f"{'PASS' if ok else 'FAIL'} (bar 0.05)",
            f"Searched {self.n_candidates} candidates over {self.n_periods} periods "
            f"({self.n_bootstrap} bootstraps, block {self.block}).",
            "  - " + ("The best strategy beats what a search this wide throws up by luck."
                     if ok else
                     "The best strategy is NOT distinguishable from the luckiest of this many random tries."),
        ])


def _block_bootstrap_index(n: int, block: int, rng: np.random.Generator) -> np.ndarray:
    """Circular moving-block bootstrap indices of length `n` — preserves short-range autocorrelation."""
    out = np.empty(n, dtype=np.int64)
    filled = 0
    while filled < n:
        start = int(rng.integers(0, n))
        take = min(block, n - filled)
        out[filled:filled + take] = (np.arange(start, start + take) % n)
        filled += take
    return out


def screen(
    candidates: pd.DataFrame | dict[str, pd.Series],
    *,
    n_bootstrap: int = 1000,
    block: int = 20,
    periods_per_year: int = _TRADING_DAYS,
    seed: int = 0,
) -> ScreenResult:
    """Was the BEST strategy in a search real, or the luckiest of many? (White's Reality Check.)

    Args:
        candidates: return series of EVERY candidate you tried — a DataFrame (columns = candidates) or a
            dict {name: returns}. Aligned on their common dates.
        n_bootstrap: bootstrap resamples for the null distribution of the best statistic.
        block: moving-block length (periods) to preserve autocorrelation; ~1 for near-iid returns.
        periods_per_year: annualisation factor.
        seed: RNG seed for reproducibility.

    Returns:
        ScreenResult with `.verdict` BEST_IS_SIGNIFICANT / NO_STRATEGY_BEATS_LUCK / INSUFFICIENT_DATA
        and the family-wise Reality-Check p-value for the best performer.
    """
    df = pd.DataFrame(candidates).apply(pd.to_numeric, errors="coerce").dropna(how="any")
    F = df.to_numpy(dtype=float)
    n, k = F.shape
    if n < 60 or k < 1:
        return ScreenResult("INSUFFICIENT_DATA", "", 1.0, 0.0, 0.0, int(k), int(n), n_bootstrap, block)

    means = F.mean(axis=0)                      # per-candidate mean per period
    stds = F.std(axis=0, ddof=1)
    best = int(np.argmax(means))
    best_name = str(df.columns[best])
    v_obs = math.sqrt(n) * float(means[best])   # White's test statistic on the winner

    rng = np.random.default_rng(seed)
    ge = 0
    for _ in range(n_bootstrap):
        idx = _block_bootstrap_index(n, max(int(block), 1), rng)
        # Centre by the observed means to impose the null (no candidate has a true edge).
        boot_means = F[idx].mean(axis=0) - means
        v_star = math.sqrt(n) * float(np.max(boot_means))
        if v_star >= v_obs:
            ge += 1
    p_value = (ge + 1) / (n_bootstrap + 1)      # +1: never report an impossible p=0

    best_sharpe = float(means[best] / stds[best] * math.sqrt(periods_per_year)) if stds[best] > 0 else 0.0
    verdict = "BEST_IS_SIGNIFICANT" if p_value < 0.05 else "NO_STRATEGY_BEATS_LUCK"
    return ScreenResult(verdict, best_name, float(p_value), float(means[best] * periods_per_year),
                        best_sharpe, int(k), int(n), int(n_bootstrap), int(block))
