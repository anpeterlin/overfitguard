"""Unit tests for the OverfitGuard core. Run: PYTHONPATH=. pytest overfitguard/

Each test uses its OWN fixed-seed RNG so results are deterministic, and asserts robust INVARIANTS
(never bless a mirage as real; deflation is monotonic in trials; the inconclusive bucket exists)
rather than pinning an exact verdict on a near-threshold random draw.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from overfitguard import (
    annualized_sharpe,
    deflated_sharpe_ratio,
    kfold_oos_sharpe,
    probabilistic_sharpe_ratio,
    validate,
)


def _series(seed: int, mean: float, vol: float, n: int = 2600) -> pd.Series:
    return pd.Series(np.random.default_rng(seed).normal(mean, vol, n))


def _best_of_noise(seed: int, n_trials: int, n: int = 2600, train_frac: float = 0.65) -> pd.Series:
    noise = np.random.default_rng(seed).normal(0.0, 0.01, (n_trials, n))
    cut = int(n * train_frac)
    return pd.Series(noise[np.argmax(noise[:, :cut].mean(axis=1))])  # chosen on TRAIN only


def test_strong_real_edge_is_likely_real():
    assert validate(_series(1, 0.0012, 0.008), n_trials=20).verdict == "LIKELY_REAL"


def test_mined_noise_is_never_blessed_as_real():
    # The core safety guarantee: a strategy mined from pure noise must NEVER come back LIKELY_REAL,
    # and its deflated confidence must fall short of the 95% bar.
    for seed in range(6):
        v = validate(_best_of_noise(seed, 1500), n_trials=1500)
        assert v.verdict != "LIKELY_REAL"
        assert v.deflated_sharpe < 0.95


def test_pure_noise_single_trial_is_not_real():
    for seed in range(6):
        assert validate(_series(seed, 0.0, 0.01), n_trials=1).verdict != "LIKELY_REAL"


def test_inconclusive_bucket_is_reachable():
    # A fixed, MODERATE genuine edge (reliably positive out-of-sample, but not overwhelming), as the
    # claimed trial count rises, must walk DOWN the confidence ladder LIKELY_REAL -> INCONCLUSIVE ->
    # LIKELY_OVERFIT — i.e. INCONCLUSIVE (not a jump straight to "overfit") is the honest middle.
    edge = _series(2, 0.0008, 0.010)
    assert validate(edge).out_of_sample_sharpe > 0  # a real edge: OOS is positive
    sweep = (1, 10, 100, 1_000, 10_000, 10**5, 10**6, 10**8)
    verdicts = {validate(edge, n_trials=n).verdict for n in sweep}
    assert "LIKELY_REAL" in verdicts       # trusted at low trial counts
    assert "INCONCLUSIVE" in verdicts      # the honest middle exists
    assert "LIKELY_OVERFIT" in verdicts    # and enough claimed searching explains it away


def test_deflation_is_monotonic_in_trials():
    r = _series(4, 0.0006, 0.010)
    d1, d100, d10k = (deflated_sharpe_ratio(r, n) for n in (1, 100, 10_000))
    assert d1 >= d100 >= d10k  # the more you searched, the lower the confidence


def test_psr_in_unit_interval_and_increases_with_sharpe():
    lo = probabilistic_sharpe_ratio(_series(5, 0.0001, 0.010))
    hi = probabilistic_sharpe_ratio(_series(5, 0.0010, 0.010))
    assert 0.0 <= lo <= 1.0 and 0.0 <= hi <= 1.0
    assert hi > lo


def test_insufficient_data():
    assert validate(_series(6, 0.0, 0.01, n=40), n_trials=1).verdict == "INSUFFICIENT_DATA"


def test_benchmark_comparison_populated():
    v = validate(_series(7, 0.0009, 0.008), n_trials=10, benchmark=_series(8, 0.0007, 0.010))
    assert v.benchmark_sharpe is not None and v.beats_benchmark_oos in {True, False}


def test_benchmark_shorter_is_not_silently_dropped():
    # A benchmark shorter than the strategy can't be aligned to the sealed holdout; it must be skipped
    # LOUDLY (a note), never silently ignored as if no benchmark were passed.
    strat = _series(7, 0.0009, 0.008, n=2600)
    short = _series(8, 0.0007, 0.010, n=2000)
    v = validate(strat, n_trials=10, benchmark=short)
    assert v.benchmark_sharpe is None and v.beats_benchmark_oos is None
    assert any("Benchmark ignored" in n for n in v.notes)


def test_benchmark_longer_is_aligned_not_miswindowed():
    # A longer benchmark must be aligned to the strategy's first n periods (with a note), so the
    # out-of-sample comparison uses the SAME window — not a misaligned tail of the longer series.
    strat = _series(7, 0.0009, 0.008, n=2600)
    long_b = _series(8, 0.0007, 0.010, n=3200)
    v = validate(strat, n_trials=10, benchmark=long_b)
    assert v.benchmark_sharpe is not None and v.beats_benchmark_oos in {True, False}
    assert any("truncated" in n for n in v.notes)
    # aligning to the first 2600 must match validating against an explicitly-truncated benchmark
    import numpy as _np
    truncated = _np.asarray(long_b)[:2600]
    assert validate(strat, n_trials=10, benchmark=truncated).benchmark_sharpe == v.benchmark_sharpe


def test_report_is_readable_and_mentions_verdict():
    v = validate(_series(9, 0.0009, 0.008), n_trials=10)
    text = v.report()
    assert v.verdict in text and "Deflated Sharpe" in text and "out-of-sample" in text


def test_annualized_sharpe_scales():
    r = _series(10, 0.0005, 0.010)
    assert abs(annualized_sharpe(r, 252) / annualized_sharpe(r, 63) - 2.0) < 1e-9  # sqrt(252/63)=2


def test_constant_series_is_zero_sharpe_not_infinite():
    # A flat (zero-variance) return series carries no risk-adjusted signal. Float rounding used to
    # leave np.std at ~1e-19 instead of exactly 0, blowing the Sharpe up to ~1e17 and mislabelling a
    # flat line as a stellar strategy (LIKELY_REAL). Any constant series must read Sharpe 0 ->
    # FAILS_OUT_OF_SAMPLE, deterministically, whatever the constant's value or the series length.
    for c in (0.001, 0.0007, 0.0035, -0.002, -0.0078, 0.0, 1234.5):  # values that leak WITHOUT the guard
        for n in (199, 200, 250):
            r = np.full(n, c)
            assert annualized_sharpe(r) == 0.0
            v = validate(r)
            assert v.full_sharpe == 0.0 and v.in_sample_sharpe == 0.0 and v.out_of_sample_sharpe == 0.0
            assert v.verdict == "FAILS_OUT_OF_SAMPLE"


def test_extreme_trial_count_does_not_crash():
    # A pathologically large trial count must NOT raise (the inv_cdf(1.0) guard) and must read as
    # explained-by-luck, with a valid probability. (Regression for the forensic-audit crash.)
    r = _series(11, 0.001, 0.010)
    for n in (10**16, 10**18, 10**30):
        v = validate(r, n_trials=n)
        assert v.verdict in {"LIKELY_OVERFIT", "FAILS_OUT_OF_SAMPLE", "INCONCLUSIVE"}
        assert 0.0 <= v.deflated_sharpe <= 1.0
        assert 0.0 <= deflated_sharpe_ratio(r, n) <= 1.0


def test_kfold_consistent_for_persistent_edge():
    # A genuinely persistent edge is positive in EVERY contiguous sub-period, not just the tail holdout.
    kr = kfold_oos_sharpe(_series(0, 0.0011, 0.008), k=5)
    assert len(kr.fold_sharpes) == 5
    assert kr.frac_folds_positive == 1.0
    assert kr.consistent and kr.min_sharpe > 0


def test_kfold_flags_front_loaded_mirage_as_inconsistent():
    # Strong early drift, clearly negative tail: at least one fold is negative -> NOT consistent, and the
    # edge visibly decays across time. This is what a single tail holdout can catch only noisily.
    rng = np.random.default_rng(3)
    n, cut = 2600, int(2600 * 0.6)
    x = np.empty(n)
    x[:cut] = rng.normal(0.0015, 0.008, cut)
    x[cut:] = rng.normal(-0.0012, 0.008, n - cut)
    kr = kfold_oos_sharpe(pd.Series(x), k=5)
    assert not kr.consistent
    assert kr.min_sharpe < 0
    assert kr.frac_folds_positive < 1.0
    assert kr.fold_sharpes[-1] < kr.fold_sharpes[0]  # decays across time


def test_kfold_embargo_and_degenerate_guards():
    r = _series(1, 0.0008, 0.010, n=1000)
    assert kfold_oos_sharpe(r, k=1).k == 2                      # k coerced to >= 2
    assert 0.0 <= kfold_oos_sharpe(r, k=5).frac_folds_positive <= 1.0
    assert kfold_oos_sharpe(r, k=5, embargo=20).embargo == 20
    empty = kfold_oos_sharpe(pd.Series(np.zeros(6)), k=5)        # too little data for 5 folds
    assert empty.fold_sharpes == () and empty.consistent is False
    assert "cross-validation" in kfold_oos_sharpe(r, k=4).report()
