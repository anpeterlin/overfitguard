"""
LAB 1 — Manufacture a mirage, then watch OverfitGuard catch it.  (Companion to Chapter 1.)

You will search 2,000 PURE-NOISE strategies, keep the one that looked best in-sample, and admire its
gorgeous Sharpe — then discover it is nothing. This is the billion-keys problem, built with your own
hands so you never trust a raw backtest again.

Run:  python lab1_the_mirage.py
"""
import numpy as np
import pandas as pd

from overfitguard import validate

rng = np.random.default_rng(1)
T = 3000

# 2,000 strategies that are, by construction, WORTHLESS (zero true edge — pure coin flips).
noise = rng.normal(0.0, 0.01, (2000, T))

# Keep the one with the best Sharpe on the first 65% (the "training" data) — exactly what a parameter
# sweep does when it hands you "the best configuration."
train = int(T * 0.65)
winner = noise[np.argmax(noise[:, :train].mean(axis=1))]
insample_sharpe = winner[:train].mean() / winner[:train].std() * np.sqrt(252)
print(f"Best of 2,000 noise strategies — in-sample Sharpe: {insample_sharpe:.2f}  (looks great, doesn't it?)\n")

# Now the truth. If you (dishonestly) claim you only tried 1 strategy, deflation can't save you — but
# the sealed holdout still catches the decay. If you're honest (2000 trials), deflation buries it too.
print("### If you LIE and say you tried 1 strategy ###")
print(validate(pd.Series(winner), n_trials=1).report())
print("\n### If you're HONEST that you tried 2,000 ###")
print(validate(pd.Series(winner), n_trials=2000).report())

print("\nLesson: the in-sample Sharpe was never evidence. It is what a search PRODUCES. Only the "
      "holdout and the deflation tell you the truth.")
