"""Tests for the multi-candidate screener (White's Reality Check) and the HTML report."""
from __future__ import annotations

import numpy as np
import pandas as pd

from overfitguard import html_report, screen, validate


def _noise_search(seed: int, k: int = 300, n: int = 2600) -> pd.DataFrame:
    noise = np.random.default_rng(seed).normal(0.0, 0.01, (k, n))
    return pd.DataFrame({f"cfg_{i}": noise[i] for i in range(k)})


def test_pure_noise_search_finds_nothing():
    # The best of a large PURE-NOISE search must NOT be declared significant (that is the whole point).
    for seed in range(4):
        r = screen(_noise_search(seed), n_bootstrap=400, block=10)
        assert r.verdict == "NO_STRATEGY_BEATS_LUCK"
        assert r.reality_check_p_value >= 0.05


def test_a_planted_real_edge_is_found_amongst_noise():
    # One candidate has a genuine edge, hidden among 300 noise strategies -> it should be flagged.
    df = _noise_search(1, k=300)
    df["cfg_real"] = np.random.default_rng(99).normal(0.0016, 0.010, len(df))  # strong planted edge
    r = screen(df, n_bootstrap=600, block=10)
    assert r.verdict == "BEST_IS_SIGNIFICANT"
    assert r.best_name == "cfg_real"
    assert r.reality_check_p_value < 0.05


def test_screen_p_value_bounds_and_metadata():
    r = screen(_noise_search(2, k=50), n_bootstrap=300)
    assert 0.0 < r.reality_check_p_value <= 1.0     # (+1 smoothing -> never exactly 0
    assert r.n_candidates == 50 and r.n_periods == 2600


def test_constant_best_column_reports_zero_sharpe_not_infinite():
    # A flat (zero-range) winning column has no risk-adjusted return, but float noise in numpy's std
    # would otherwise leak a spurious ~1e17 best_sharpe. Any constant best column -> Sharpe 0. The
    # values below are ones that leak WITHOUT the range guard (0.001 alone would pass on a broken build).
    for v in (0.001, -0.002, 0.0, 0.0007, 0.0035, -0.0078):
        df = pd.DataFrame({"flat": np.full(200, v), "lower": np.full(200, v - 0.05)})
        r = screen(df, n_bootstrap=100)
        assert r.best_name == "flat"
        assert r.best_sharpe_annual == 0.0


def test_screen_insufficient_data():
    tiny = pd.DataFrame({"a": np.random.default_rng(0).normal(0, 0.01, 40)})
    assert screen(tiny).verdict == "INSUFFICIENT_DATA"


def test_html_report_is_self_contained_for_both_result_types():
    v = validate(pd.Series(np.random.default_rng(0).normal(0.001, 0.008, 2600)), n_trials=10)
    s = screen(_noise_search(0, k=40), n_bootstrap=200)
    for result in (v, s):
        page = html_report(result)
        assert page.startswith("<!doctype html>")
        assert result.verdict in page
        assert "http://" not in page and "https://" not in page  # no external resources -> self-contained
