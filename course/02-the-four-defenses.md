# 2 · The four defenses

If a high in-sample Sharpe isn't evidence, what is? Four things. Each attacks one of the ways you fool
yourself, and OverfitGuard implements all four so you can run them in three lines.

```bash
pip install overfitguard
```

## Defense 1 — Out-of-sample: decode the next message

Split your history in time. **Search, tune, and choose your strategy using only the earlier part.**
Then — once, at the very end — check it on the later part you sealed away and never looked at. A real
edge survives the unseen data. A fitted mirage falls apart on it.

This is the single most powerful defense, because it's the one thing multiplicity can't fake: you can
torture the training data all you like, but you never touched the holdout.

```python
from overfitguard import validate
result = validate(my_returns, n_trials=1)
print(result.out_of_sample_sharpe)   # the number that matters
```

The catch: a single holdout is *noisy*, and if you peek at it — even once, even by re-running "just to
check" — it stops being sealed. Discipline is the whole game.

## Defense 2 — The Deflated Sharpe Ratio: pay for every key you tried

You tried 300 configurations. The Deflated Sharpe Ratio *(Bailey & López de Prado)* asks: **how good
would the *best of 300 worthless* strategies look, by luck alone?** — and makes your winner clear
*that* bar, not zero. The more you searched, the higher the bar climbs.

```python
validate(my_returns, n_trials=300).deflated_sharpe   # P(real) after 300 trials
```

Be honest with `n_trials`. A grid of 20 parameters × 15 thresholds is **300 trials, not one.**
Under-report it and you've disabled your own smoke detector.

## Defense 3 — White's Reality Check: judge the whole search at once

Sometimes you don't have "one strategy and a trial count" — you have *500 candidate strategies* and
want to know if the best one is real. White's Reality Check bootstraps the whole family under the null
that none of them has an edge, and asks whether your champion beats what that many random tries throw
up.

```python
from overfitguard import screen
print(screen(all_candidates).report())   # a DataFrame, one column of returns per candidate
```

It counts the trials *for* you — so it can't be fooled by an optimistic trial count.

## Defense 4 — Costs: subtract the friction

None of the above matters if your returns are gross. Feed OverfitGuard **net-of-cost** returns:
subtract spread, commission, slippage, and (if you short) borrow. Many "edges" are real gross and
dead net — high-turnover strategies especially. The friction was always part of the truth.

## Putting it together

```python
result = validate(net_returns, n_trials=300, benchmark=buy_and_hold_returns)
print(result.report())
```

```
VERDICT: LIKELY_OVERFIT
Deflated Sharpe (P edge is real after 300 trials): 26.1%  FAIL (bar 95%)
Sharpe — full 0.70 | in-sample 1.07 | out-of-sample 0.01 (retained 1%)
```

*(This is a real run: the best of 300 pure-noise strategies, chosen on the training data. Reproduce it
with the `validate()` call above on `examples/` data.)*

That 1.07 in-sample Sharpe felt like a discovery. Out of sample it's **0.01** — a coin that came up
heads a few extra times in training and nothing at all afterwards. The tool didn't *make* it fake — it
was always fake. It just refused to let you believe otherwise.

One more thing you need to internalize before we go on: **`INCONCLUSIVE` is a common and honest verdict,
not a rejection.** These defenses are strict on purpose (they hold a ~5% false-positive line), which
means a *genuine* but modest edge over a short record will often come back "promising, not proven." The
cure is more data — never a lower bar.

---
**Next:** [The graveyard →](03-the-graveyard.md)
