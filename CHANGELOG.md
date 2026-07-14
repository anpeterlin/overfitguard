# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Backend scaffolding** (`/api`, Vercel serverless) for real, server-verified Pro entitlement
  replacing the bypassable client-side flag: a Lemon Squeezy webhook (raw-body HMAC-verified), a
  Supabase-backed entitlement store (`MemoryStore` fallback for local dev), and a Supabase-JWT-gated
  `/api/entitlement` endpoint. No runtime dependencies; full local test suite
  (`node --test api/_lib/backend.test.mjs`) plus a CI job. Activates on setting the Tier-0 env vars
  (see `BACKEND.md` / `.env.example`) — no code change needed. Not shipped in the pip package.

## [0.3.1] — 2026-07-13

### Added
- The **K-fold cross-validation** section now renders in the HTML report (`html_report(result, kfold=...)`),
  the CLI (`validate ... --kfold K --html out.html` embeds it), and the browser web app (shown in the
  result panel and included in the downloaded report) — surfacing the 0.3.0 engine feature on every UI.

## [0.3.0] — 2026-07-13

### Added
- **K-fold cross-validation of the out-of-sample Sharpe** — `kfold_oos_sharpe(returns, k=5, embargo=0)`
  (exported at the top level) and a `KFoldResult` with per-fold Sharpes, `mean`/`min`/`std`, the fraction
  of positive folds, and a strict `consistent` flag (every fold positive). A single tail holdout is
  noisy; this shows whether an edge holds *across time* rather than in one lucky window. Exposed on the
  CLI as `overfitguard validate ... --kfold K [--embargo E]`, mirrored in the browser engine
  (`OverfitGuard.kfoldOosSharpe`) to floating-point parity, and documented in `docs/METHODS.md`.

## [0.2.1] — 2026-07-13

### Fixed
- **Zero-variance (constant) return series no longer report a spurious ~1e17 "infinite Sharpe."**
  A flat line could previously read `LIKELY_REAL` in `validate()` or report a `~1e17` best Sharpe in
  `screen()`, because floating-point rounding left the standard deviation just above zero. Sharpe is
  now gated on the actual range (`max == min` / `np.ptp == 0`) in both the Python library
  (`core.py`, `screen.py`) and the browser engine (`web/overfitguard.js`); a constant series returns
  Sharpe `0` deterministically.
- **`validate()` no longer silently drops a mismatched-length benchmark.** A benchmark shorter than
  the strategy is skipped with an explicit note (it cannot be aligned to the sealed holdout); a longer
  one is aligned to the strategy's first *n* periods (also noted), instead of comparing a misaligned
  window.
- Corrected the web app: the engine file (`overfitguard.js`) had been misnamed, leaving the
  "Run audit" button silently non-functional.

### Added
- Continuous integration: `pytest` on Python 3.9 / 3.11 / 3.12 plus a standalone JavaScript
  degenerate-input regression sweep, on every push and pull request.
- The PyPI publish workflow is now gated on the full test matrix and validates artifacts
  (`twine check`) before upload.
- Regression coverage for the constant-series and benchmark-alignment fixes, and a self-contained
  JS gate at `web/_parity/check_degenerate.js`.
- "Open the web app" calls-to-action on the landing page.
- Repository hygiene: `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and issue/PR templates.

## [0.2.0]

### Added
- Initial public release: Deflated Sharpe Ratio (Bailey & López de Prado) and Probabilistic Sharpe
  Ratio, a sealed out-of-sample holdout, and White's Reality Check for multi-candidate searches.
- `overfitguard` CLI (`validate` / `screen`) with self-contained HTML reports.
- A browser engine (a faithful JavaScript port of the core) and web app.
- The "Fooled by Backtests" companion course with hands-on labs.
