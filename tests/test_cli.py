"""Tests for the command-line CSV handling.

These lock down a real, environment-dependent bug: under pandas >= 2 a date column
reports its dtype as ``str`` (not ``object``), so the old date-detection let the date
column survive ``to_numeric`` as an all-NaN column and be picked as the "returns"
series — silently yielding a zero-length result. See ``cli._read_csv``.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from overfitguard.cli import _one_series, _read_csv, main


def _returns(n: int = 2600, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).normal(0.001, 0.008, n)


def _write_with_date_index(path, returns) -> None:
    """Write a CSV exactly like the bundled sample: an *unnamed* leading date column."""
    dates = pd.bdate_range("2014-01-02", periods=len(returns))
    pd.DataFrame({"returns": returns}, index=dates).to_csv(path)  # -> header ",returns"


def test_unnamed_date_index_is_not_read_as_returns(tmp_path):
    # The regression: an unnamed date column must NOT become an all-NaN "returns" series.
    csv = tmp_path / "s.csv"
    r = _returns()
    _write_with_date_index(csv, r)

    series = _one_series(_read_csv(str(csv)), None)
    assert len(series) == len(r)                 # was 0 before the fix
    assert not series.isna().any()
    np.testing.assert_allclose(series.to_numpy(), r, rtol=1e-6)


def test_named_date_column_moved_to_index(tmp_path):
    csv = tmp_path / "s.csv"
    r = _returns()
    dates = pd.bdate_range("2014-01-02", periods=len(r))
    pd.DataFrame({"date": dates, "returns": r}).to_csv(csv, index=False)

    df = _read_csv(str(csv))
    assert list(df.columns) == ["returns"]       # date column consumed as the index
    assert len(_one_series(df, None)) == len(r)


def test_plain_returns_column_no_date(tmp_path):
    csv = tmp_path / "s.csv"
    r = _returns()
    pd.DataFrame({"returns": r}).to_csv(csv, index=False)
    assert len(_one_series(_read_csv(str(csv)), None)) == len(r)


def test_named_column_selection_and_missing_column(tmp_path):
    csv = tmp_path / "s.csv"
    r = _returns()
    pd.DataFrame({"date": pd.bdate_range("2014-01-02", periods=len(r)),
                  "alpha": r, "beta": r * 2}).to_csv(csv, index=False)
    df = _read_csv(str(csv))
    assert len(_one_series(df, "beta")) == len(r)
    with pytest.raises(SystemExit):
        _one_series(df, "does_not_exist")


def test_csv_with_no_numeric_column_errors(tmp_path):
    csv = tmp_path / "s.csv"
    pd.DataFrame({"date": pd.bdate_range("2014-01-02", periods=5),
                  "label": list("abcde")}).to_csv(csv, index=False)
    with pytest.raises(SystemExit):
        _read_csv(str(csv))


def test_main_validate_end_to_end(tmp_path, capsys):
    csv = tmp_path / "s.csv"
    _write_with_date_index(csv, _returns())
    rc = main(["validate", str(csv), "--trials", "50"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "2600 periods" in out                 # reads the whole series, not zero
    assert "INSUFFICIENT_DATA" not in out


def test_main_screen_end_to_end_with_date_index(tmp_path, capsys):
    csv = tmp_path / "c.csv"
    rng = np.random.default_rng(1)
    frame = pd.DataFrame({f"cfg_{i}": rng.normal(0, 0.01, 2600) for i in range(20)})
    frame.insert(0, "date", pd.bdate_range("2014-01-02", periods=2600))
    frame.to_csv(csv, index=False)
    rc = main(["screen", str(csv), "--bootstrap", "200"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Searched 20 candidates over 2600 periods" in out
