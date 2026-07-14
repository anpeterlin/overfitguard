"""Self-contained HTML reports for a ValidationResult or ScreenResult (inline CSS, no dependencies)."""
from __future__ import annotations

import html
from typing import Any

_VERDICT_COLOR = {
    "LIKELY_REAL": "#1a7f37", "BEST_IS_SIGNIFICANT": "#1a7f37",
    "SURVIVES_DEFLATION_BUT_DECAYS_OOS": "#9a6700", "INCONCLUSIVE": "#9a6700",
    "FAILS_OUT_OF_SAMPLE": "#cf222e", "LIKELY_OVERFIT": "#cf222e",
    "NO_STRATEGY_BEATS_LUCK": "#cf222e", "INSUFFICIENT_DATA": "#57606a",
}
_VERDICT_PLAIN = {
    "LIKELY_REAL": "This edge survived the multiplicity you subjected it to AND held up on data the "
                   "search never saw. As real as a backtest gets — proceed with normal caution.",
    "SURVIVES_DEFLATION_BUT_DECAYS_OOS": "Statistically significant, but the edge shrinks out-of-sample. "
                                         "Real-ish, but weaker than the in-sample number suggests.",
    "INCONCLUSIVE": "Out-of-sample is positive, but the track record is too short or the Sharpe too "
                    "modest to prove it for the number of strategies you tried. Promising, not proven.",
    "FAILS_OUT_OF_SAMPLE": "The edge vanishes (or reverses) on data the search never touched. This is "
                           "the classic data-mined mirage — do not trade it.",
    "LIKELY_OVERFIT": "A search this wide would produce a backtest this good by luck. The in-sample "
                      "result is not evidence of a real edge.",
    "BEST_IS_SIGNIFICANT": "The best strategy in your search beats what that many random tries would "
                           "throw up by luck. It has earned a closer look.",
    "NO_STRATEGY_BEATS_LUCK": "The best strategy is indistinguishable from the luckiest of this many "
                              "random tries. The search found nothing real.",
    "INSUFFICIENT_DATA": "Not enough data to reach an honest verdict.",
}

_CSS = """
:root{color-scheme:light dark}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
 margin:0;background:#f6f8fa;color:#1f2328}
.wrap{max-width:680px;margin:40px auto;padding:0 20px}
.card{background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:28px 30px;
 box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:19px;margin:0 0 2px}.sub{color:#57606a;font-size:13px;margin:0 0 22px}
.verdict{display:inline-block;font-weight:700;font-size:15px;color:#fff;padding:7px 16px;border-radius:999px}
.plain{margin:18px 0 24px;font-size:15px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
td,th{text-align:left;padding:9px 4px;border-bottom:1px solid #eaeef2;font-size:14px}
th{color:#57606a;font-weight:600}td.n{text-align:right;font-weight:600}
.foot{margin-top:22px;color:#8b949e;font-size:12px}
.kfold{margin-top:22px;border-top:1px solid #eaeef2;padding-top:16px}
.kfold h2{font-size:14px;color:#57606a;font-weight:600;margin:0 0 10px}
.folds{display:flex;flex-wrap:wrap;gap:6px}
.fold{font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;padding:4px 9px;border-radius:6px;color:#fff}
.fold.pos{background:#1a7f37}.fold.neg{background:#cf222e}
.kf-sum{color:#57606a;font-size:13px;margin:10px 0 4px}
.kf-verdict{font-size:14px;font-weight:600;margin:0}
@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}
 .card{background:#161b22;border-color:#30363d}.sub,th,.foot,.kfold h2,.kf-sum{color:#8b949e}
 td,th,.kfold{border-color:#21262d}}
"""


def _row(label: str, value: str, n: bool = True) -> str:
    cls = ' class="n"' if n else ""
    return f"<tr><td>{html.escape(label)}</td><td{cls}>{html.escape(value)}</td></tr>"


def _page(title: str, verdict: str, rows: str, foot: str, extra: str = "") -> str:
    color = _VERDICT_COLOR.get(verdict, "#57606a")
    plain = _VERDICT_PLAIN.get(verdict, "")
    return (
        f"<!doctype html><html><head><meta charset='utf-8'>"
        f"<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(title)}</title><style>{_CSS}</style></head><body><div class='wrap'>"
        f"<div class='card'><h1>OverfitGuard</h1><p class='sub'>{html.escape(title)}</p>"
        f"<span class='verdict' style='background:{color}'>{html.escape(verdict)}</span>"
        f"<p class='plain'>{html.escape(plain)}</p>"
        f"<table>{rows}</table>{extra}<p class='foot'>{html.escape(foot)}</p></div></div></body></html>"
    )


def _kfold_block(kf: Any) -> str:
    """HTML for a KFoldResult (per-fold Sharpe chips + consistency verdict). Empty string if absent."""
    if kf is None or not getattr(kf, "fold_sharpes", None):
        return ""
    chips = "".join(
        f'<span class="fold {"pos" if s > 0 else "neg"}">{s:.2f}</span>' for s in kf.fold_sharpes
    )
    consistent = kf.consistent
    verdict = ("CONSISTENT — the edge is positive in every sub-period." if consistent
               else "NOT consistent — the edge is absent or negative in at least one sub-period.")
    color = "#1a7f37" if consistent else "#cf222e"
    return (
        f"<div class='kfold'><h2>K-fold out-of-sample cross-validation ({kf.k} folds)</h2>"
        f"<div class='folds'>{chips}</div>"
        f"<p class='kf-sum'>mean {kf.mean_sharpe:.2f} · min {kf.min_sharpe:.2f} · "
        f"positive in {kf.frac_folds_positive * 100:.0f}% of folds</p>"
        f"<p class='kf-verdict' style='color:{color}'>{html.escape(verdict)}</p></div>"
    )


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def html_report(result: Any, kfold: Any = None) -> str:
    """Render a ValidationResult or ScreenResult as a self-contained HTML page (a string you can save).

    Pass an optional ``kfold`` (a ``KFoldResult``) alongside a ValidationResult to append a K-fold
    out-of-sample cross-validation section. Ignored for a ScreenResult.
    """
    v = result.verdict
    if hasattr(result, "deflated_sharpe"):  # ValidationResult
        rows = "".join([
            _row("Deflated Sharpe (P edge is real)", f"{result.deflated_sharpe * 100:.1f}%"),
            _row("Trials you tried", f"{result.n_trials:,}"),
            _row("Full-sample Sharpe", f"{result.full_sharpe:.2f}"),
            _row("In-sample Sharpe", f"{result.in_sample_sharpe:.2f}"),
            _row("Out-of-sample Sharpe", f"{result.out_of_sample_sharpe:.2f}"),
            _row("Out-of-sample retention", _pct(result.oos_retention)),
        ] + ([_row("Benchmark Sharpe", f"{result.benchmark_sharpe:.2f}"),
              _row("Beats benchmark out-of-sample", "yes" if result.beats_benchmark_oos else "no")]
             if result.benchmark_sharpe is not None else []))
        foot = (f"{result.n_periods:,} periods · {int(result.holdout_frac * 100)}% sealed as holdout · "
                "Deflated Sharpe (Bailey & López de Prado) + sealed out-of-sample holdout.")
        return _page("Single-strategy reality check", v, rows, foot, extra=_kfold_block(kfold))

    # ScreenResult
    rows = "".join([
        _row("Best candidate", result.best_name, n=False),
        _row("Reality-Check p-value", f"{result.reality_check_p_value:.3f}"),
        _row("Best annual return", _pct(result.best_mean_annual)),
        _row("Best Sharpe", f"{result.best_sharpe_annual:.2f}"),
        _row("Candidates searched", f"{result.n_candidates:,}"),
    ])
    foot = (f"{result.n_periods:,} periods · {result.n_bootstrap:,} bootstraps · block {result.block} · "
            "White's Reality Check (Sullivan, Timmermann & White).")
    return _page("Search screen", v, rows, foot)
