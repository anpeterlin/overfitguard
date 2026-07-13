# OverfitGuard

**An honest reality-check for trading strategies.** Before you risk a dollar on a backtest, answer the
one question that actually matters: *is this a real edge, or did I fool myself?*

Search hard enough over historical data and you will **always** find something that looks brilliant
in-sample — by pure luck. OverfitGuard applies the discipline that separates a real edge from a
data-mined mirage, and it **refuses to bless anything that can't survive it**:

- **Deflated Sharpe Ratio** *(Bailey & López de Prado, 2014)* — penalises your Sharpe for how many
  strategies you tried, how long your track record is, and how fat-tailed your returns are.
- **Sealed out-of-sample holdout** — the "does it still work on data it has never seen" test that
  catches regime-fitting the deflation math can't.
- **White's Reality Check** *(Sullivan, Timmermann & White)* — judges a *whole search* at once: was the
  best of your 500 configs real, or just the luckiest?

Two independent defenses on a single strategy, plus a family-wise test for a search. Dependency-light
(just `numpy`/`pandas`), framework-agnostic, and it never sees your data source, broker, or secret sauce.

## Install

```bash
pip install overfitguard          # once published to PyPI
# or from source:
pip install -e ".[test]"
```

## Library — 30 seconds

```python
import pandas as pd
from overfitguard import validate, screen

# One strategy — be honest about how many configs you tried:
result = validate(my_returns, n_trials=250, benchmark=spy_returns)
print(result.verdict)             # LIKELY_REAL / INCONCLUSIVE / LIKELY_OVERFIT / ...
print(result.report())

# A whole search — was the best candidate real?
print(screen(all_candidate_returns).report())   # candidates = DataFrame, one column each
```

## Command line

```bash
overfitguard validate returns.csv --trials 250 --benchmark spy.csv --html report.html
overfitguard screen candidates.csv --bootstrap 2000 --html screen.html
```

`--html` writes a self-contained, theme-aware report you can open in any browser or hand to a client.
See two real outputs without installing anything: a **[caught mirage](examples/mirage_report.html)**
(`FAILS_OUT_OF_SAMPLE`) and a **[genuine edge](examples/sample_report.html)** (`LIKELY_REAL`) — proof
the verdict swings both ways. Regenerate them with `--trials 500` (mirage) and `--trials 300` (genuine
edge) on the matching `*_returns.csv`.

## The verdicts

| Verdict | Meaning |
|---|---|
| `LIKELY_REAL` | Survives deflation for the trials you tried **and** holds up out-of-sample. |
| `SURVIVES_DEFLATION_BUT_DECAYS_OOS` | Significant, but the edge shrinks on unseen data. Caution. |
| `INCONCLUSIVE` | Out-of-sample positive, but too short / too modest to prove for the trials tried. |
| `FAILS_OUT_OF_SAMPLE` | The edge vanishes or reverses on data the search never saw — the classic mirage. |
| `LIKELY_OVERFIT` | A search that wide would produce a Sharpe this good by luck. |
| `BEST_IS_SIGNIFICANT` / `NO_STRATEGY_BEATS_LUCK` | (search screen) the best candidate beats — or doesn't — what that many random tries throw up. |

## Why it's honest

The number that fools most people is the **in-sample Sharpe** — and OverfitGuard treats a high one as
*expected*, not as evidence. If you tell it you tried one strategy when you really tried a thousand, the
sealed holdout is there to catch the decay anyway.

> It will not tell you that you found alpha. It will tell you whether you have *earned the right to
> believe it* — which is rarer, and worth far more.

## Learn the ideas — the companion course

**[Fooled by Backtests](course/README.md)** is a short, free course that teaches these defenses *by
using this tool* on real data — including a research program that rigorously tested a dozen strategy
families and found buy-and-hold beat essentially all of them. It ends with **[hands-on
labs](course/labs/README.md)**: manufacture a mirage and watch it get caught, screen 250 candidates for
the one real edge, and — the capstone — **audit your own strategy in one command.**

## Limitations & how to read the verdict

OverfitGuard is deliberately a **skeptic**. Understand these before you use it (the full treatment,
with formulas and calibration evidence, is in **[docs/METHODS.md](docs/METHODS.md)**):

- **`INCONCLUSIVE` is common, and it does *not* mean "fake."** The engine is tuned for a low
  false-positive rate (≈5% at the 95% bar, confirmed by Monte-Carlo calibration), which costs it
  power: a *genuine* edge with a modest Sharpe or a short track record — especially one found after
  many trials — will often read `INCONCLUSIVE`. That is the honest answer ("promising, not proven"),
  not a rejection. More data is the cure.
- **A `LIKELY_REAL` at `n_trials=1` is still a 5%-false-positive test.** If you under-report how many
  configurations you tried, you are weakening the deflation — the sealed holdout is the backstop, but
  be honest with `n_trials`.
- **`screen()` tests each candidate's mean return against zero (cash), not against a benchmark.** It
  answers "does the best of these have positive expected return beyond luck?" — not "does it beat
  buy-and-hold." Bring your own benchmark by screening excess-over-benchmark returns.
- **Approximations, stated plainly:** the deflation's multiplicity bar uses the strategy's own Sharpe
  estimator variance as a proxy for the dispersion of your trial Sharpes; and the out-of-sample check
  is a *single* 35% holdout, which is itself noisy (purged K-fold cross-validation is on the roadmap).
- It is a **research / due-diligence tool, not financial advice.** `LIKELY_REAL` means "you have earned
  the right to believe it," not "trade this."

## Project layout

```
overfitguard/
  pyproject.toml            # pip-installable, exposes the `overfitguard` CLI
  index.html                # self-contained landing page (GitHub Pages front door)
  src/overfitguard/         # core.py · screen.py · report.py · cli.py
  tests/                    # 27 tests (core, screener, CLI)
  examples/                 # quickstart.py + two sample HTML reports (a catch and a pass)
  course/                   # "Fooled by Backtests" — 5 chapters + hands-on labs + capstone
  docs/METHODS.md           # the maths, calibration evidence, and limitations in full
  .github/workflows/ci.yml  # tests on 3.9 / 3.11 / 3.12
```

## License

MIT. OverfitGuard is a research/due-diligence tool — it does not give financial advice, and
`LIKELY_REAL` is not a recommendation to trade.
