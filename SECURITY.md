# Security Policy

## Supported versions

OverfitGuard is pre-1.0; only the latest released version on PyPI receives fixes.

| Version | Supported |
|---|---|
| latest `0.2.x` | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for security-sensitive reports. Instead, use GitHub's private
vulnerability reporting: on the repository's **Security** tab, click **"Report a vulnerability."**
We aim to acknowledge within a few days.

## Scope and threat model

OverfitGuard is a local analysis tool, which shapes what "security" means here:

- **The Python library and CLI run entirely on your machine.** They read a returns file and compute a
  verdict — no network calls, no telemetry, no data leaves your environment.
- **The browser app (`web/`) computes entirely client-side.** Your return series never leave the
  browser. The only outbound request is an optional license-key check to the payment provider
  (Lemon Squeezy); no strategy data is sent.
- OverfitGuard is **research/due-diligence tooling, not financial advice**, and a `LIKELY_REAL`
  verdict is not a recommendation to trade.

Reports we especially want: input handling that could crash or mislead (e.g. a crafted CSV that
produces a wrong verdict), any path by which strategy data could leak, or dependency vulnerabilities.
