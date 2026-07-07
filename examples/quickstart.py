"""
OverfitGuard in 60 seconds. Run:  python examples/quickstart.py

Shows both entry points on synthetic data:
  * validate() — judge one strategy, honest about how many you tried;
  * screen()   — judge a whole search at once (White's Reality Check).
"""
import numpy as np
import pandas as pd

from overfitguard import screen, validate

rng = np.random.default_rng(0)
T = 2600

# --- validate(): a genuine edge vs. a data-mined mirage ------------------------------------------
print("### validate() ###\n")

real_edge = pd.Series(rng.normal(0.0011, 0.008, T))     # a genuine, persistent drift
print(validate(real_edge, n_trials=25).report(), "\n")

noise = rng.normal(0, 0.01, (2000, T))                  # search 2000 worthless strategies...
mirage = pd.Series(noise[np.argmax(noise[:, : int(T * 0.65)].mean(axis=1))])  # ...keep the best in-sample
print(validate(mirage, n_trials=2000).report(), "\n")

# --- screen(): was the best of a whole search real? ----------------------------------------------
print("\n### screen() ###\n")

candidates = pd.DataFrame({f"cfg_{i}": noise[i] for i in range(200)})  # 200 pure-noise candidates
print(screen(candidates, n_bootstrap=1000).report())
