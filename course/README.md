# Fooled by Backtests

### A short, honest course on why your trading strategy probably isn't real — and how to know when it is.

Every other quant course shows you a *winning* backtest. This one hands you a **graveyard of honest
failures** and the tools that dug the graves — because in trading research, knowing what *doesn't*
work (and being able to *prove* it) is rarer and worth more than one more curve that goes up and to
the right.

It is the companion course to **[OverfitGuard](../README.md)**, the free open-source library that
gives any strategy an honest "real edge or overfit?" verdict. You'll learn the ideas *by using the
tool* on real data — including a real research program that rigorously tested a dozen strategy families
and an exhaustive 9,308-signal search, and found that **buy-and-hold beat essentially all of them.**

## Who this is for

Anyone who has ever felt the jolt of a backtest with a 2.0 Sharpe and thought *"I found something."*
Retail algo traders, aspiring quants, finance students, and skeptics who want to stop fooling
themselves. You need basic Python and `pip install overfitguard`. No PhD required.

## Syllabus

1. **[Why your backtest is lying to you](01-why-your-backtest-is-lying.md)** — search + luck, and the
   code-breaker's real secret.
2. **[The four defenses](02-the-four-defenses.md)** — out-of-sample, the Deflated Sharpe Ratio, White's
   Reality Check, and costs — hands-on with OverfitGuard.
3. **[The graveyard](03-the-graveyard.md)** — a guided tour of ~13 "edges" that died, and the one
   pattern behind all of them.
4. **[What actually works](04-what-actually-works.md)** — the boring, reliable answer the evidence
   keeps pointing to.
5. **[A research protocol that won't fool you](05-a-research-protocol.md)** — the checklist, and how to
   operationalize it.

## Hands-on labs — where reading becomes knowing

The chapters teach the ideas; the **[labs](labs/README.md)** make them yours. They're turnkey (bundled
data, no downloads) and build to the one that matters:

- **Lab 1** — manufacture a beautiful backtest from pure noise and watch the tool expose it.
- **Lab 2** — run all four defenses on a real moving-average strategy, net of costs.
- **Lab 3** — screen 250 candidates and find the one real edge buried in the noise.
- **🎯 Capstone** — **audit your *own* strategy.** One command, an honest verdict, a shareable report.
  The moment you run it on a backtest *you* believed in is the moment this course pays for itself.

Plus **[exercises with worked solutions](labs/exercises.md)**.

## The one idea

If you remember nothing else: **a high in-sample Sharpe is not evidence.** It's what a big enough
search *always* produces. Evidence is what survives data it has never seen, after you've paid honest
costs and owned up to how many things you tried. This course teaches you the difference — and the
tool enforces it.

> The goal of research is not to find alpha. It's to earn the right to believe you did.

*Honesty note: this course contains no signals to trade and makes no promise you'll beat the market —
the evidence in Chapter 3 suggests you probably won't. It is a course in intellectual honesty applied
to money.*
