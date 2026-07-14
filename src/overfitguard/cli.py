"""
Command-line interface: `overfitguard validate ...` and `overfitguard screen ...`.

    overfitguard validate returns.csv --trials 250 [--benchmark spy.csv] [--html out.html]
    overfitguard screen candidates.csv [--bootstrap 2000] [--block 20] [--html out.html]

CSV format: `validate` reads the first (or a named) numeric column as the strategy's periodic returns;
`screen` reads every numeric column as one candidate. A leading date column is used as the index if present.
"""
from __future__ import annotations

import argparse
import sys

import pandas as pd

from overfitguard.core import kfold_oos_sharpe, validate
from overfitguard.report import html_report
from overfitguard.screen import screen


def _read_csv(path: str) -> pd.DataFrame:
    """Read a CSV of returns, moving a leading date/label column to the index.

    Robust across pandas dtype backends: `is_numeric_dtype` catches a non-numeric
    first column whether its dtype is object, string, or str (pandas >= 2 reports a
    date column as ``str``, not ``object``). As a backstop, any column that is
    entirely non-numeric is dropped, so a date column can never masquerade as a
    return series and silently produce a zero-length result.
    """
    df = pd.read_csv(path)
    first = df.columns[0]
    if (not pd.api.types.is_numeric_dtype(df[first])
            or "date" in str(first).lower()
            or str(first).startswith("Unnamed")):
        df = df.set_index(first)
    numeric = df.apply(pd.to_numeric, errors="coerce").dropna(axis=1, how="all")
    if numeric.shape[1] == 0:
        raise SystemExit(f"No numeric return column found in {path}.")
    return numeric


def _one_series(df: pd.DataFrame, column: str | None) -> pd.Series:
    if column is not None:
        if column not in df.columns:
            raise SystemExit(f"Column {column!r} not found; available: {list(df.columns)}")
        return df[column].dropna()
    return df.iloc[:, 0].dropna()


def _emit(result, html_path: str | None, kfold=None) -> None:
    print(result.report())
    if kfold is not None:
        print("\n" + kfold.report())
    if html_path:
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(html_report(result, kfold=kfold))
        print(f"\nHTML report written to {html_path}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="overfitguard",
                                     description="An honest reality-check for trading strategies.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("validate", help="judge ONE strategy (Deflated Sharpe + sealed holdout)")
    v.add_argument("csv", help="CSV of the strategy's periodic (net-of-cost) returns")
    v.add_argument("--trials", type=int, default=1, help="how many configurations you TRIED (be honest)")
    v.add_argument("--column", default=None, help="name of the returns column (default: first numeric)")
    v.add_argument("--benchmark", default=None, help="CSV of benchmark returns (e.g. buy-and-hold)")
    v.add_argument("--holdout", type=float, default=0.35, help="tail fraction sealed as out-of-sample")
    v.add_argument("--periods", type=int, default=252, help="periods per year (252 daily, 12 monthly)")
    v.add_argument("--kfold", type=int, default=0,
                   help="also run K-fold out-of-sample cross-validation with this many folds (0 = off)")
    v.add_argument("--embargo", type=int, default=0, help="periods trimmed from each fold end in --kfold")
    v.add_argument("--html", default=None, help="also write a self-contained HTML report here")

    s = sub.add_parser("screen", help="judge a WHOLE search (White's Reality Check)")
    s.add_argument("csv", help="CSV whose columns are the returns of every candidate you tried")
    s.add_argument("--bootstrap", type=int, default=1000, help="bootstrap resamples")
    s.add_argument("--block", type=int, default=20, help="moving-block length (periods)")
    s.add_argument("--periods", type=int, default=252, help="periods per year")
    s.add_argument("--html", default=None, help="also write a self-contained HTML report here")

    args = parser.parse_args(argv)

    if args.cmd == "validate":
        returns = _one_series(_read_csv(args.csv), args.column)
        bench = _one_series(_read_csv(args.benchmark), None) if args.benchmark else None
        result = validate(returns, n_trials=args.trials, holdout_frac=args.holdout,
                          benchmark=bench, periods_per_year=args.periods)
        kfold = (kfold_oos_sharpe(returns, k=args.kfold, embargo=args.embargo,
                                  periods_per_year=args.periods) if args.kfold else None)
        _emit(result, args.html, kfold=kfold)
    else:
        candidates = _read_csv(args.csv).select_dtypes("number")
        result = screen(candidates, n_bootstrap=args.bootstrap, block=args.block,
                        periods_per_year=args.periods)
        _emit(result, args.html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
