"""
OverfitGuard core — the Deflated Sharpe Ratio + sealed out-of-sample holdout, from first principles.

No dependency on any data source, broker, or trading framework: everything here operates on a plain
series of periodic returns. The maths follows Bailey & López de Prado, "The Deflated Sharpe Ratio"
(2014): a Sharpe ratio is only credible once it is penalised for (a) the number of strategies you
tried, (b) the length of the track record, and (c) the non-normality (skew/fat tails) of the returns.
We add a chronological holdout because deflation catches multiplicity but not regime-fitting.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist

import numpy as np
import pandas as pd

_NORM = NormalDist()
_EULER_GAMMA = 0.5772156649015329
_TRADING_DAYS = 252


# ---------------------------------------------------------------------------
# Sharpe primitives.
# ---------------------------------------------------------------------------


def _clean(returns: pd.Series | np.ndarray) -> np.ndarray:
    r = pd.Series(returns).astype(float)
    return r[np.isfinite(r)].to_numpy()


def _per_period_sharpe(r: np.ndarray) -> float:
    if r.size < 2:
        return 0.0
    sd = float(np.std(r, ddof=1))
    return float(np.mean(r) / sd) if sd > 0 else 0.0


def annualized_sharpe(returns: pd.Series | np.ndarray, periods_per_year: int = _TRADING_DAYS) -> float:
    """Annualised Sharpe ratio of a periodic return series (zero risk-free; same convention throughout)."""
    return _per_period_sharpe(_clean(returns)) * math.sqrt(periods_per_year)


def _sr_estimator_variance(sr: float, n: int, skew: float, kurt: float) -> float:
    """Variance of the (per-period) Sharpe estimator given non-normality (kurt is NON-excess: normal=3).
    This is the denominator of the Probabilistic Sharpe Ratio, so PSR and the deflation share one model."""
    if n < 2:
        return float("inf")
    return (1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr) / (n - 1)


def probabilistic_sharpe_ratio(
    returns: pd.Series | np.ndarray, sr_star: float = 0.0, periods_per_year: int = _TRADING_DAYS
) -> float:
    """P(true Sharpe > `sr_star`), accounting for track-record length, skew and kurtosis.

    `sr_star` is an ANNUALISED threshold Sharpe (0 = "better than nothing"). Returns a probability in
    [0, 1]; >= 0.95 is the usual bar.
    """
    r = _clean(returns)
    n = r.size
    if n < 3:
        return 0.0
    sr_pp = _per_period_sharpe(r)
    skew = float(pd.Series(r).skew())
    kurt = float(pd.Series(r).kurt()) + 3.0  # pandas gives EXCESS kurtosis; formula wants non-excess
    var = _sr_estimator_variance(sr_pp, n, skew, kurt)
    if not math.isfinite(var) or var <= 0:
        return 0.0
    sr_star_pp = sr_star / math.sqrt(periods_per_year)
    return float(_NORM.cdf((sr_pp - sr_star_pp) / math.sqrt(var)))


def _expected_max_sharpe(n_trials: int, sr_estimator_sd: float) -> float:
    """Expected MAXIMUM per-period Sharpe from `n_trials` truly-worthless strategies (true Sharpe = 0).
    This is the bar a real edge must clear: if your best backtest isn't better than the best fluke a
    search this wide throws up, it is a fluke. (Bailey & López de Prado, eq. for E[max].)"""
    if n_trials <= 1:
        return 0.0
    # Guard the tail probabilities away from 1.0: once n_trials > ~1e16, `1 - 1/n_trials` rounds to
    # exactly 1.0 in float64 and NormalDist().inv_cdf(1.0) raises. Cap at ~8 sigma so an absurd trial
    # count just yields a very high (finite) bar — DSR -> 0 -> LIKELY_OVERFIT — instead of crashing.
    cap = 1.0 - 1e-15
    z1 = _NORM.inv_cdf(min(1.0 - 1.0 / n_trials, cap))
    z2 = _NORM.inv_cdf(min(1.0 - 1.0 / (n_trials * math.e), cap))
    return sr_estimator_sd * ((1.0 - _EULER_GAMMA) * z1 + _EULER_GAMMA * z2)


def deflated_sharpe_ratio(
    returns: pd.Series | np.ndarray, n_trials: int, periods_per_year: int = _TRADING_DAYS
) -> float:
    """Probability the strategy's Sharpe is real AFTER penalising for `n_trials` configurations tried.

    Deflated Sharpe = PSR measured against the expected-maximum Sharpe of `n_trials` worthless
    strategies, not against zero. The more you searched, the higher the bar. Returns a probability;
    >= 0.95 means the edge survives the multiplicity you subjected it to.
    """
    r = _clean(returns)
    n = r.size
    if n < 3:
        return 0.0
    sr_pp = _per_period_sharpe(r)
    skew = float(pd.Series(r).skew())
    kurt = float(pd.Series(r).kurt()) + 3.0
    var = _sr_estimator_variance(sr_pp, n, skew, kurt)
    if not math.isfinite(var) or var <= 0:
        return 0.0
    sr_star_pp = _expected_max_sharpe(max(int(n_trials), 1), math.sqrt(var))
    return float(_NORM.cdf((sr_pp - sr_star_pp) / math.sqrt(var)))


# ---------------------------------------------------------------------------
# The verdict.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidationResult:
    verdict: str
    deflated_sharpe: float           # P(edge real | n_trials) — the multiplicity-honest number
    full_sharpe: float               # annualised, whole sample
    in_sample_sharpe: float          # annualised, training portion
    out_of_sample_sharpe: float      # annualised, sealed holdout (the "next message")
    oos_retention: float             # oos / in-sample (1.0 = no decay; <=0 = died out of sample)
    n_trials: int
    n_periods: int
    holdout_frac: float
    benchmark_sharpe: float | None
    beats_benchmark_oos: bool | None
    notes: tuple[str, ...]

    def report(self) -> str:
        pct = f"{self.deflated_sharpe * 100:.1f}%"
        lines = [
            "=== OverfitGuard — strategy reality check ===",
            f"VERDICT: {self.verdict}",
            f"Deflated Sharpe (P edge is real after {self.n_trials} trials): {pct}"
            f"  {'PASS' if self.deflated_sharpe >= 0.95 else 'FAIL'} (bar 95%)",
            f"Sharpe — full {self.full_sharpe:.2f} | in-sample {self.in_sample_sharpe:.2f} "
            f"| out-of-sample {self.out_of_sample_sharpe:.2f} (retained {self.oos_retention * 100:.0f}%)",
            f"Track record: {self.n_periods} periods, {int(self.holdout_frac * 100)}% sealed as holdout",
        ]
        if self.benchmark_sharpe is not None:
            beats = "yes" if self.beats_benchmark_oos else "NO"
            lines.append(f"Benchmark Sharpe {self.benchmark_sharpe:.2f} | beats it out-of-sample: {beats}")
        lines.extend("  - " + n for n in self.notes)
        return "\n".join(lines)


def validate(
    returns: pd.Series | np.ndarray,
    n_trials: int = 1,
    *,
    holdout_frac: float = 0.35,
    benchmark: pd.Series | np.ndarray | None = None,
    periods_per_year: int = _TRADING_DAYS,
) -> ValidationResult:
    """Honest reality-check of a strategy's periodic (already net-of-cost) return series.

    Args:
        returns: the strategy's per-period returns, in chronological order (e.g. daily).
        n_trials: how many strategy configurations you TRIED before choosing this one. Be honest — a
            grid of 500 parameter sets is 500 trials, and the deflation scales with it. Under-count
            this and you are lying to yourself.
        holdout_frac: fraction of the tail sealed as out-of-sample. The search must never have touched
            it (that is your responsibility — pass the returns of the config chosen on the training part).
        benchmark: optional buy-and-hold (or any) benchmark returns, aligned to `returns`.
        periods_per_year: annualisation factor (252 daily, 52 weekly, 12 monthly).

    Returns:
        A ValidationResult whose `.verdict` is one of LIKELY_REAL / SURVIVES_DEFLATION_BUT_DECAYS_OOS /
        INCONCLUSIVE / FAILS_OUT_OF_SAMPLE / LIKELY_OVERFIT / INSUFFICIENT_DATA, plus `.report()`.
    """
    r = _clean(returns)
    notes: list[str] = []
    if r.size < 60:
        return ValidationResult("INSUFFICIENT_DATA", 0.0, 0.0, 0.0, 0.0, 0.0, int(n_trials),
                                int(r.size), holdout_frac, None, None,
                                ("Need >= 60 periods to say anything honest.",))

    split = int(round(r.size * (1.0 - holdout_frac)))
    split = min(max(split, 30), r.size - 30)
    is_r, oos_r = r[:split], r[split:]

    dsr = deflated_sharpe_ratio(r, n_trials, periods_per_year)
    full_sr = annualized_sharpe(r, periods_per_year)
    is_sr = annualized_sharpe(is_r, periods_per_year)
    oos_sr = annualized_sharpe(oos_r, periods_per_year)
    retention = float(oos_sr / is_sr) if is_sr > 0 else (0.0 if oos_sr <= 0 else 1.0)

    bench_sr: float | None = None
    beats_oos: bool | None = None
    if benchmark is not None:
        b = _clean(benchmark)
        if b.size >= r.size:
            bench_sr = annualized_sharpe(b, periods_per_year)
            beats_oos = bool(annualized_sharpe(b[split:], periods_per_year) < oos_sr)

    deflation_ok = dsr >= 0.95
    oos_alive = oos_sr > 0
    oos_holds = oos_sr >= 0.5 * is_sr  # retains at least half the in-sample edge

    # Order matters: an edge that DIES out-of-sample is the clearest mirage, so test it first —
    # otherwise reserve LIKELY_OVERFIT for deflation clearly failing, and INCONCLUSIVE (not overfit!)
    # for the honest middle ground where the record is simply too short to prove either way.
    if not oos_alive:
        verdict = "FAILS_OUT_OF_SAMPLE"
        notes.append("The edge vanishes (or reverses) on data the search never saw — the classic mirage.")
    elif deflation_ok and oos_holds:
        verdict = "LIKELY_REAL"
        notes.append("Survives deflation for the trials tried AND holds up out-of-sample.")
    elif deflation_ok:
        verdict = "SURVIVES_DEFLATION_BUT_DECAYS_OOS"
        notes.append("Significant after deflation, but the edge shrinks out-of-sample — treat with caution.")
    elif dsr < 0.5:
        verdict = "LIKELY_OVERFIT"
        notes.append(f"A search of {n_trials} trials would throw up a Sharpe this good by luck; deflated "
                     f"probability is only {dsr * 100:.1f}%.")
    else:
        verdict = "INCONCLUSIVE"
        notes.append(f"Out-of-sample is positive, but at {dsr * 100:.1f}% deflated confidence the record "
                     "is too short / the Sharpe too modest to prove real for the trials tried — promising, "
                     "not proven. Collect more track record before trusting it.")
    if benchmark is not None and beats_oos is False:
        notes.append("Does NOT beat the benchmark out-of-sample — even if 'real', it isn't worth trading.")

    return ValidationResult(verdict, dsr, full_sr, is_sr, oos_sr, retention, int(n_trials), int(r.size),
                            holdout_frac, bench_sr, beats_oos, tuple(notes))
