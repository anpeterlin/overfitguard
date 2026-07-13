<!-- Thanks for contributing to OverfitGuard. Keep PRs focused on one logical change. -->

## What & why

<!-- What does this change, and why? Link any issue it closes (e.g. "Closes #12"). -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Statistical / methodology change (cite a source + include a calibration/Monte-Carlo check)
- [ ] Docs / tests / tooling only

## Checklist

- [ ] `pytest -q` passes
- [ ] `ruff check src tests` passes
- [ ] `node web/_parity/check_degenerate.js` passes
- [ ] If I changed the Python core, I kept `web/overfitguard.js` in lockstep (same verdicts/numbers)
- [ ] I updated the README / docstrings / `CHANGELOG.md` for any behavior change
- [ ] New behavior is covered by a test that would fail without the change
