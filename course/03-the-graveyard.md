# 3 · The graveyard

Theory is cheap. Here is a real research program that applied the four defenses — honestly,
pre-registered, net of costs, with sealed holdouts — to roughly **a dozen** strategy families and one
exhaustive brute-force search. This is what disciplined research actually looks like: mostly graves.

Every headstone below is a strategy that, somewhere on the internet, someone is selling as a system.

## The headstones

| Strategy | What it promised | Honest verdict |
|---|---|---|
| Single-name technical signals | chart patterns predict returns | **null** — no cost-surviving edge |
| Cross-sectional relative value | cheap-vs-dear ranking | **null** |
| Fundamental factors | value/quality/profitability | **null** net of costs |
| Long-only momentum | ride the winners | **disguised market beta** (β≈0.85) — you reinvented the index |
| Long/short momentum | market-neutral winners-minus-losers | **no neutral alpha** (α t = −0.33) |
| Short-term reversal | buy the dip, systematically | **loses money** net of costs (α t = −4.72) |
| Cointegration pairs | statistical arbitrage | **null** (α t = −3.02) |
| Post-earnings drift (PEAD) | prices drift after surprises | **arbitraged away** net of costs |
| **Multi-asset trend** | the famous crisis-hedge premium | **real pre-2015, then decayed** (Sharpe 0.79 → 0.35; alpha t 2.80 → 0.44) |
| **FOMC pre-announcement drift** | stocks drift up before Fed meetings | **real pre-2011, dead after** (+0.34%/mtg t=3.31 → +0.08% t=0.71) |
| **Overnight effect** | all the return happens overnight | **real but uneconomic** — dies on the cost of trading the open/close daily |
| **9,308-signal exhaustive search** | surely *something* is in there | **nothing** survived noise + holdout + cost + consistency |
| Put-writing / covered calls (VRP) | "income" from selling options | **underperformed buy-and-hold** — less return, *same* drawdown, worse skew |

## Three lessons the graveyard teaches

**1. Decay is real, and it's the signature of a *published* edge.** Look at trend and the FOMC drift.
Both were genuinely, statistically real in the older data — and both collapsed to insignificance in the
modern era, right around the time they became famous. This is the single most replicated finding in
quantitative finance: *published anomalies get arbitraged away.* If a strategy is well-known enough for
you to have heard of it, assume that too. The defense that caught this — a pre-registered split into
"before" and "after" — is Defense 1 (out-of-sample) wearing a different hat.

**2. The flashiest in-sample result is the most dangerous.** The exhaustive search tested 9,308
signals. Fourteen of them beat a stringent multiple-testing benchmark. Then **thirteen of those
fourteen evaporated on the sealed holdout.** Without the holdout, you'd have "found" fourteen edges and
traded all of them. *That* is the billion-keys problem, live.

**3. Even the "real" premium wasn't free money.** The one effect that survived — the overnight return
— is genuinely persistent. But harvesting it means trading at the open and close *every single day*,
and realistic costs eat the thin margin. And put-writing, the internet's favorite "income" strategy,
lost to just holding the index: **8.3%/yr vs 14.7%, with the same drawdown.** Its famous "yield" was
upside sold at a bad price, dressed up as income.

## The one pattern behind all of it

Squint and every one of these is the same bet: *when should I be exposed to the market, and when
should I be out?* Momentum, trend, the FOMC drift, the overnight effect — all timing overlays on equity
risk. And the benchmark that beat essentially every one of them, net of costs, was the most boring
thing imaginable:

> **Buy the index and hold it. Sharpe ≈ 0.65. It beat the lot.**

That's not a disappointment. It's the most useful thing thirteen honest experiments can tell you — and
it's the subject of the next chapter.

---
**Next:** [What actually works →](04-what-actually-works.md)
