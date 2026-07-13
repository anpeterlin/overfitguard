# Contributing to OverfitGuard

Thanks for your interest. OverfitGuard is a small, dependency-light library with a companion
browser engine; the bar for changes is **correctness and honesty** — the tool exists to *refuse*
to bless overfit strategies, so a change that weakens a defense needs a very good reason.

## Development setup

```bash
git clone https://github.com/anpeterlin/overfitguard
cd overfitguard
pip install -e ".[test]"
```

## Running the checks (all must pass before you open a PR)

```bash
pytest -q                              # Python test suite
ruff check src tests                   # lint
node web/_parity/check_degenerate.js   # JS degenerate-input regression gate
```

If you touch the Python core (`src/overfitguard/core.py`, `screen.py`) **and** the browser engine
(`web/overfitguard.js`), keep them in lockstep — the JS is a faithful port and must produce the same
verdicts and (to floating-point tolerance) the same numbers as the Python library.

## What we look for

- **Tests for behavior, not implementation.** Assert invariants (e.g. "mined noise is never
  `LIKELY_REAL`", "deflation is monotonic in trials") rather than pinning a near-threshold verdict.
- **No new runtime dependencies** beyond `numpy`/`pandas` without discussion.
- **Statistical changes** must cite a source and include a calibration or Monte-Carlo check.
- **Docs stay true.** If you change behavior, update the README, docstrings, and `CHANGELOG.md`.

## Commit / PR conventions

- One logical change per PR; describe *why*, not just *what*.
- Reference any issue you're closing.
- CI (pytest on 3.9/3.11/3.12 + the JS gate) must be green.

## Reporting bugs / requesting features

Open an issue using the templates. For anything security-sensitive, see [SECURITY.md](SECURITY.md).
