# 1 · Why your backtest is lying to you

You found it. A rule — some moving-average cross, some RSI threshold, some clever combination — and
when you backtested it, the equity curve went up and to the right with a Sharpe of 1.8. You feel the
jolt. *This is real.*

It almost certainly isn't. Here's why, and it has nothing to do with your code being buggy.

## The billion keys

Imagine a code-breaker with one intercepted enemy message. He tries key after key. Try enough keys —
millions, billions — and **one of them will turn that message into something that looks like real
words.** Guaranteed. Not because he broke the code, but because with enough attempts, random noise
coughs up a pattern by pure chance.

How does he know if he *actually* cracked it? Only one way: **the same key has to decode the *next*
message he's never seen.** The first message proves nothing — he fitted to it. The second message is
the test.

Your backtest is the first message. Every parameter you tuned, every indicator you swapped, every
threshold you nudged — each was a key. You didn't try a billion, but you tried more than you think,
and the market has enough noise that *something* was always going to look brilliant on the data you
optimized against.

## The three ways you fooled yourself

**1. Multiplicity — you tried many things.** If you test one coin for fairness, five heads in a row is
suspicious. If you test a thousand coins, *several* will throw five heads by luck, and you'll proudly
show off the "hot" one. Every parameter grid, every "let me just try one more indicator," multiplies
your chances of a false positive. The Sharpe of your *best* rule out of 500 is not the Sharpe of a
good rule — it's the Sharpe of the *luckiest* rule.

**2. Overfitting — you fitted to one regime.** Markets have moods: the 2010s bull, the 2008 crash, the
2022 rate shock. A rule tuned on one era learns that era's quirks, not a durable truth. It looks great
until the mood changes — which, out of sample, it always does.

**3. Costs — you ignored the tax on trading.** Spreads, commissions, slippage, borrow fees. Many a
"profitable" high-turnover strategy is pure fiction once you subtract what it actually costs to trade
it. The edge was always smaller than the friction.

## Why the in-sample Sharpe is worthless as evidence

Here is the mental flip this whole course is built on:

> A high in-sample Sharpe is **expected**, not surprising. It is what a search *produces*. Treating it
> as evidence of a real edge is like being impressed that the winning lottery ticket had winning
> numbers.

The number that feels most convincing — the beautiful backtested Sharpe — is precisely the number you
must learn to distrust. What counts is what's left *after* you account for how many keys you tried,
whether it decodes the next message, and what it costs to trade.

That "after" is measurable. The rest of this course is the four ways to measure it — and a graveyard
of real strategies that looked exactly like your 1.8-Sharpe winner and turned out to be noise.

---
**Next:** [The four defenses →](02-the-four-defenses.md)
