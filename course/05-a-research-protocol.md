# 5 · A research protocol that won't fool you

You don't need a hedge fund's infrastructure to do honest research. You need a protocol you follow
*before* you get excited, because excitement is when the fooling happens. Here is the one this course's
research program used. Print it. Follow it in order.

## Before you touch the data

1. **Write down your hypothesis and your bar — first.** What effect, in what universe, measured how,
   and what result would make you *reject* it? Pre-registration isn't bureaucracy; it's the difference
   between testing an idea and rummaging until something looks good.
2. **Seal a holdout you swear not to look at.** Decide the split now (e.g., last 35% of history, or a
   pre/post-publication date). It does not exist until the final step.

## While you search

3. **Count every trial — honestly.** Every parameter, threshold, and "let me try one more" is a trial.
   Keep the tally. You'll feed it to the deflation, and it is *always* higher than it feels.
4. **Use net-of-cost returns from the start.** Spread + commission + slippage + borrow. If the edge only
   exists gross, it doesn't exist.
5. **Check sub-period stability.** Does it work in the first half *and* the second? A real effect is
   continuous; a fitted one lives in one lucky window. (This is how trend and the FOMC drift were caught
   decaying.)

## Before you believe it

6. **Deflate, or screen.** One finalist and a trial count → `validate(..., n_trials=N)`. A whole search
   → `screen(all_candidates)`. Clear the multiplicity bar, not zero.
7. **Break the seal — once.** Run the finalist on the untouched holdout. One look. Whatever it says, it
   says.
8. **Compare to the honest benchmark.** Beating cash is not the point. Does it beat *buy-and-hold*, net,
   out-of-sample? If not, it isn't worth trading even if it's "real."

## When you report it

9. **State a claim boundary.** Write down, explicitly, what you did *not* demonstrate. "No validated
   alpha; not tested net of X; single holdout." The discipline of naming what you didn't prove is what
   keeps a result honest when you show it to someone else — or to yourself in six months.
10. **Let `INCONCLUSIVE` be a valid answer.** Most honest research ends here, not at `LIKELY_REAL`. That
    is not failure. A well-earned "I don't know yet" beats a confident lie every time.

## The whole thing in one function

OverfitGuard exists to make steps 3, 6, 7, and 8 impossible to skip:

```python
from overfitguard import validate
print(validate(net_returns, n_trials=my_honest_trial_count,
               benchmark=buy_and_hold, holdout_frac=0.35).report())
```

It will not tell you that you found alpha. Almost always, it will tell you that you didn't — and *that*
is the service. The rare time it comes back `LIKELY_REAL`, you'll have earned the right to believe it,
which is the only kind of belief worth having with your own money.

---

That's the course. You now know why backtests lie, the four defenses against it, a graveyard of
strategies that failed those defenses, what actually works instead, and a protocol to keep yourself
honest.

The one sentence to carry out the door:

> **The goal of research is not to find alpha. It's to earn the right to believe you did.**

← [Back to the syllabus](README.md)
