"""
LAB 3 — Judge a whole search at once.  (Companion to Chapters 2 & 3.)

Sometimes you don't have one strategy and a trial count — you have a folder of 250 candidate configs
and one question: is the BEST of them real, or just the luckiest? That is exactly what White's Reality
Check answers. The bundled search has 249 pure-noise strategies and ONE genuine, buried edge.

Run:  python lab3_the_screener.py
"""
from pathlib import Path

import pandas as pd

from overfitguard import screen

HERE = Path(__file__).parent

candidates = pd.read_csv(HERE / "data" / "candidates.csv", parse_dates=["date"]).set_index("date")

print(f"Screening {candidates.shape[1]} candidate strategies over {candidates.shape[0]} days...\n")
result = screen(candidates, n_bootstrap=1000, block=10)
print(result.report())

print("\nThe screener found the needle in the haystack — a real edge hidden among 249 noise\n"
      "strategies — WITHOUT you having to count trials honestly. Now delete the real one and re-run:")
print(">>> screen(candidates.drop(columns=['cfg_007']))   # -> NO_STRATEGY_BEATS_LUCK")

# Prove the counterfactual: with the one real edge removed, the best of pure noise is NOT significant.
noise_only = candidates.drop(columns=[c for c in candidates.columns if c == "cfg_007"])
verdict = screen(noise_only, n_bootstrap=1000, block=10).verdict
print(f"\n(Confirmed: without cfg_007, the verdict is {verdict}.)")
