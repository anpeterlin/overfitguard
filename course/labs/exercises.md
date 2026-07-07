# Exercises

Do these after the labs. Solutions are at the bottom — try first. Each takes a few minutes and cements
one idea you'll use for the rest of your trading life.

## 1. Feel the multiplicity bar move

Take the sample strategy (`data/your_strategy.csv`) and run `validate()` with `n_trials` = 1, 10, 100,
1000, 100000. Watch the deflated Sharpe fall. **At what trial count does an honest researcher lose the
right to call any modest edge "real"?**

## 2. Break the holdout on purpose

In `lab2`, tune the moving-average lengths (`fast`, `slow`) by hand until the **in-sample** Sharpe
looks great. Now look at the **out-of-sample** number. Then set `n_trials` to the number of
combinations you actually tried while tuning. What happened to the verdict — and why is that the honest
result?

## 3. Hide a weaker edge

In `make_data.py`, change the buried edge (`cfg[7]`) from a daily mean of `0.0009` down to `0.0004`.
Regenerate and re-run `lab3`. Does the screener still find it? **What does it mean for your real
research that a genuine-but-thin edge can hide from even a proper test?**

## 4. The honest benchmark

Re-run the capstone but delete the `benchmark=` argument. The verdict may not change — but what
information did you just throw away, and why is "beats cash" a dishonest bar for a strategy?

## 5. Your turn (the real one)

Export the daily returns of a strategy you actually believe in — one you've backtested and felt good
about. Run `python capstone.py your_returns.csv N`, with `N` = the true number of configurations you
tried (be brutally honest). Sit with the verdict.

---

## Solutions

**1.** Deflated Sharpe drops monotonically as trials rise (the bar climbs). For a sample strategy whose
edge is already dead out-of-sample, it reads `FAILS_OUT_OF_SAMPLE` throughout — but for a *modest real*
edge, somewhere around a few hundred to a few thousand trials the deflated probability falls below 95%
and the honest verdict becomes `INCONCLUSIVE` or `LIKELY_OVERFIT`. **Lesson:** a wide grid search can
make *any* modest Sharpe indefensible. Search less, or demand far more data.

**2.** Tuning raises the in-sample Sharpe (that's what tuning *does*) while the out-of-sample number
barely moves or falls. Once you set `n_trials` to your real search size, the deflation catches the
tuning and the verdict degrades to `INCONCLUSIVE`/`LIKELY_OVERFIT`. **That is the honest result** — the
extra in-sample Sharpe you "found" was fitted, and neither the holdout nor the deflation is fooled.

**3.** At `0.0004` the edge is much thinner; the screener will *often fail to find it* (a higher p-value,
sometimes `NO_STRATEGY_BEATS_LUCK`). **Lesson:** absence of significance is not proof of no edge —
genuine but small effects hide inside noise, which is exactly why over-searching is so dangerous (you
can't tell a hidden real edge from a lucky fluke without more data). Conservatism cuts both ways.

**4.** You threw away the only comparison that matters: *does it beat buy-and-hold, out-of-sample?* A
strategy can be statistically "real" (positive expected return beyond luck) and still **lose to simply
owning the index** — see the put-writing headstone in Chapter 3. "Beats cash" flatters almost anything;
"beats the benchmark net of costs" is the honest bar.

**5.** There is no solution key for this one. If it came back `LIKELY_REAL`, stress it harder before you
believe it. If it came back anything else — which is the common case — you just saved yourself real
money, which was the entire point.
