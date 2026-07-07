"""
CAPSTONE — audit YOUR OWN strategy.

This is the point of the whole course: run the four defenses on a real backtest and get an honest
verdict. It ships pointed at a sample strategy that looks brilliant in-sample and is a mirage out of
it — so you see the tool bite — then you swap in your own returns and find out the truth about it.

Run:
    python capstone.py                       # audit the sample strategy
    python capstone.py path/to/your.csv 300  # audit YOUR returns, honest about trials

Your CSV needs a column of periodic (daily) net-of-cost returns. A `date` column is optional.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

from overfitguard import html_report, validate

HERE = Path(__file__).parent


def _returns(path: Path, prefer: str) -> pd.Series:
    df = pd.read_csv(path)
    if prefer in df.columns:
        return pd.to_numeric(df[prefer], errors="coerce").dropna()
    num = df.select_dtypes("number")
    return num.iloc[:, -1].dropna()  # last numeric column (skips a numeric index if present)


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "data" / "your_strategy.csv"
    n_trials = int(sys.argv[2]) if len(sys.argv) > 2 else 200

    returns = _returns(path, "returns")
    # Benchmark: the bundled index (buy-and-hold). Beating cash is not the bar — beating this is.
    prices = pd.read_csv(HERE / "data" / "prices.csv")["close"]
    benchmark = prices.pct_change().dropna()

    print(f"Auditing: {path.name}   ({returns.size} periods, honest trial count = {n_trials})\n")
    result = validate(returns, n_trials=n_trials, benchmark=benchmark)
    print(result.report())

    out = HERE / "capstone_report.html"
    out.write_text(html_report(result))
    print(f"\nSaved a shareable HTML report -> {out.name}")

    print("\n" + "-" * 70)
    if result.verdict == "LIKELY_REAL":
        print("Rare. It cleared deflation AND the holdout AND the benchmark. Now stress it further:\n"
              "different holdout splits, live paper-trading, and be brutally honest that your true\n"
              "trial count wasn't higher than you told it.")
    elif result.verdict in {"INCONCLUSIVE", "SURVIVES_DEFLATION_BUT_DECAYS_OOS"}:
        print("The honest, common answer: promising but unproven. Do NOT bet size on it yet. Collect\n"
              "more out-of-sample track record; it is the only cure.")
    else:
        print("The verdict most real strategies get. That gorgeous in-sample curve did not survive\n"
              "data it never saw. It is not a failure of your coding — it is the billion-keys problem.\n"
              "Now do the honest thing: throw it out, and go read Chapter 4.")
    print("Swap in your own returns:  python capstone.py your_returns.csv <how_many_configs_you_tried>")


if __name__ == "__main__":
    main()
