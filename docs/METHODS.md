# Methods & limitations

This document states precisely what OverfitGuard computes, the assumptions behind each number, and
where those assumptions break. It is written for a reader doing technical due diligence on the tool.

All statistics operate on a plain series of **periodic, net-of-cost returns** in chronological order.
Nothing here depends on a data source, broker, or trading framework.

## Notation

- $r_1, \dots, r_n$ — the strategy's periodic returns.
- $\hat{SR}$ — the per-period Sharpe estimate $\bar r / s$, where $s$ is the sample standard deviation
  (`ddof=1`). Annualized by $\sqrt{P}$ with $P$ periods per year (252 daily, 52 weekly, 12 monthly).
- $\hat\gamma_3, \hat\gamma_4$ — sample skewness and (non-excess) kurtosis (pandas' bias-corrected
  estimators; the JS engine replicates them exactly).

## Zero-variance guard

A constant series has no risk-adjusted return, but floating-point rounding leaves $s$ just above zero,
which would make $\bar r / s$ explode to ~$10^{17}$. OverfitGuard decides "is this constant?" from the
**range** ($\max = \min$ / `np.ptp == 0`), not from whether $s$ rounds to zero, and returns Sharpe $0$.
This is enforced identically in the Python library and the browser engine and is covered by
regression sweeps over hundreds of thousands of constant values.

## Probabilistic Sharpe Ratio (PSR)

The variance of the Sharpe estimator under non-normal returns (Mertens 2002; Lo 2002):

$$\widehat{\mathrm{Var}}(\hat{SR}) = \frac{1 - \hat\gamma_3\,\hat{SR} + \frac{\hat\gamma_4 - 1}{4}\,\hat{SR}^2}{n-1}.$$

$\mathrm{PSR}(SR^\*) = \Phi\!\left(\dfrac{\hat{SR} - SR^\*}{\sqrt{\widehat{\mathrm{Var}}(\hat{SR})}}\right)$
is the probability the true Sharpe exceeds a threshold $SR^\*$, accounting for track-record length,
skew, and fat tails. At $SR^\*=0$ it is "probability the edge beats nothing." The usual bar is 0.95.

## Deflated Sharpe Ratio (DSR)

The DSR (Bailey & López de Prado 2014) is PSR measured against the **expected maximum** Sharpe of $N$
truly worthless strategies, not against zero:

$$SR^\*_N = \sqrt{\widehat{\mathrm{Var}}(\hat{SR})}\;\Big[(1-\gamma)\,\Phi^{-1}\!\big(1-\tfrac{1}{N}\big) + \gamma\,\Phi^{-1}\!\big(1-\tfrac{1}{N e}\big)\Big],$$

where $\gamma$ is the Euler–Mascheroni constant. The more configurations you tried ($N$), the higher
the bar. `validate(..., n_trials=N)` returns $\mathrm{PSR}(SR^\*_N)$.

**Key approximation (stated plainly).** The exact DSR scales $SR^\*_N$ by the **cross-sectional
variance of the $N$ trial Sharpes**. From a single return series that dispersion is unobservable, so
OverfitGuard substitutes the chosen strategy's own estimator variance $\widehat{\mathrm{Var}}(\hat{SR})$
as the proxy. Under the null of independent, equal-length trials this proxy $\approx 1/(n-1)$ matches
the true dispersion, and Monte-Carlo confirms the intended calibration (below). It is **least accurate
when the $N$ trials are highly correlated** (e.g. a fine parameter grid), where the effective number of
independent trials is far below $N$ and the tool tends to *over*-penalize. When you have the actual
candidate series, prefer `screen()`, which uses their real cross-correlation.

## Sealed out-of-sample holdout

Deflation addresses multiplicity but not regime-fitting, so `validate()` also splits the series
chronologically (default: last 35% sealed as holdout, each side clamped to ≥30 periods) and reports the
in-sample vs out-of-sample Sharpe and the retention ratio. The caller is responsible for having chosen
the strategy on the training portion only.

## K-fold cross-validation of the out-of-sample Sharpe

Because a single tail holdout is noisy, `kfold_oos_sharpe(returns, k=5, embargo=0)` splits the series
into `k` **contiguous** folds and reports the annualised Sharpe of each, plus `mean` / `min` / `std`,
the fraction of folds that are positive, and a strict `consistent` flag (**every** fold positive). A
genuine edge is positive across *all* sub-periods; a front-loaded mirage shows the decay (a late fold
near zero or negative) that a single holdout can miss. An optional `embargo` trims that many periods
from each end of every fold to blunt autocorrelation bleed at the boundaries — the returns-series
analogue of purging in López de Prado's purged K-fold. This is an **adaptation**, not model-CV: there
is no model training here, so "purging" reduces to the boundary embargo. Available on the CLI as
`validate ... --kfold K [--embargo E]`, and the JavaScript engine mirrors it to floating-point parity.

## The verdict ladder

Tested in this order (so a mirage that dies out-of-sample is caught first):

1. `FAILS_OUT_OF_SAMPLE` — out-of-sample Sharpe ≤ 0.
2. `LIKELY_REAL` — DSR ≥ 0.95 **and** out-of-sample retains ≥ 50% of the in-sample Sharpe.
3. `SURVIVES_DEFLATION_BUT_DECAYS_OOS` — DSR ≥ 0.95 but the edge shrinks out-of-sample.
4. `LIKELY_OVERFIT` — DSR < 0.5.
5. `INCONCLUSIVE` — the honest middle: positive out-of-sample, but 0.5 ≤ DSR < 0.95.
6. `INSUFFICIENT_DATA` — fewer than 60 periods.

## White's Reality Check (`screen`)

Given the return series of every candidate, `screen()` asks whether the *best* is genuinely good or the
luckiest of many (Sullivan, Timmermann & White 1999; White 2000). The statistic is
$\sqrt{n}\,\bar r_{\text{best}}$; the null distribution comes from a **circular moving-block bootstrap**
(default block 20) centered on the observed means. The reported p-value is $(\#\{v^\* \ge v_{\text{obs}}\}+1)/(B+1)$.
It counts the trials for you, so it cannot be fooled by an optimistic `n_trials`. Note it tests each
candidate's mean return against **zero**, not against a benchmark — screen excess-over-benchmark returns
if you want the latter. "Best" is the highest-mean candidate.

## Benchmark handling

A benchmark must be aligned to the strategy period-for-period. A benchmark shorter than the strategy is
**skipped with a note** (it cannot be aligned to the holdout window); a longer one is aligned to the
strategy's first $n$ periods (also noted). A benchmark is never silently ignored.

## Calibration evidence

Monte-Carlo over 20,000 pure-noise (zero-edge) series, $n=2000$:

- $P(\text{DSR} \ge 0.95 \mid \text{noise}, N{=}1) \approx 4.8\%$ — the intended ~5% false-positive bar.
- Mined best-of-$N$ noise with an **honest** `n_trials=N`: `LIKELY_REAL` in ~0–0.3% of runs.
- The expected-maximum formula matches direct simulation to <2% relative error (tightening with $N$).
- The Python library and the JavaScript engine agree to <10⁻⁷ on all non-degenerate inputs.

## Limitations (read before trusting a verdict)

- **`INCONCLUSIVE` is common and is not "fake."** The tool holds a low false-positive line, which costs
  power: a genuine but modest edge over a short record will often read `INCONCLUSIVE`. More data is the
  cure, not a lower bar.
- **Under-reporting `n_trials` weakens deflation.** If a strategy was mined from many configs but you
  pass `n_trials=1`, the holdout is the only backstop, and it catches only ~half of such mirages — the
  residual `LIKELY_REAL` rate is well above the nominal 5%. Be honest with `n_trials`.
- **The multiplicity proxy** (above) can over-penalize correlated searches; use `screen()` there.
- **A single 35% holdout is noisy** — a genuine edge can miss it and a mirage can fluke it. Use
  `kfold_oos_sharpe(...)` (or `validate ... --kfold K`) to cross-validate across `K` contiguous
  sub-periods and see whether the edge is *consistent across time* (see below).
- **`screen()` tests mean-vs-zero**, not vs a benchmark.
- OverfitGuard is **research/due-diligence tooling, not financial advice.** `LIKELY_REAL` means "you
  have earned the right to believe it," not "trade this."

## References

- Bailey, D. H., & López de Prado, M. (2014). *The Deflated Sharpe Ratio: Correcting for Selection Bias,
  Backtest Overfitting, and Non-Normality.* Journal of Portfolio Management.
- Mertens, E. (2002). *Comments on Variance of the IID Estimator in Lo (2002).*
- Lo, A. W. (2002). *The Statistics of Sharpe Ratios.* Financial Analysts Journal.
- Sullivan, R., Timmermann, A., & White, H. (1999). *Data-Snooping, Technical Trading Rule Performance,
  and the Bootstrap.* Journal of Finance.
- White, H. (2000). *A Reality Check for Data Snooping.* Econometrica.
