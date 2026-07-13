"""
OverfitGuard — an honest reality-check for trading strategies.

The one question every backtest should have to answer before you risk a dollar: *is this a real
edge, or did I fool myself?* A big enough search over historical data ALWAYS turns up something that
looks great in-sample — by pure luck. OverfitGuard applies the discipline that separates a real edge
from a data-mined mirage: the **Deflated Sharpe Ratio** (which penalises the observed Sharpe for how
many strategies you tried) and a **sealed out-of-sample holdout** (the "does it work on data it has
never seen" test). It refuses to bless anything that does not survive both.

    >>> import numpy as np, pandas as pd
    >>> from overfitguard import validate
    >>> r = pd.Series(np.random.default_rng(0).normal(0.0003, 0.01, 2000))  # a weak, real drift
    >>> result = validate(r, n_trials=50)      # you tried 50 configurations
    >>> print(result.verdict)
    >>> print(result.report())

This is a general-purpose library: it takes ANY strategy's periodic return series (equities, futures,
crypto, options — anything) and never sees your data source, your broker, or your secret sauce.
"""
from __future__ import annotations

from overfitguard.core import (
    ValidationResult,
    annualized_sharpe,
    deflated_sharpe_ratio,
    probabilistic_sharpe_ratio,
    validate,
)
from overfitguard.report import html_report
from overfitguard.screen import ScreenResult, screen

__all__ = [
    "validate",
    "ValidationResult",
    "screen",
    "ScreenResult",
    "html_report",
    "annualized_sharpe",
    "deflated_sharpe_ratio",
    "probabilistic_sharpe_ratio",
]
__version__ = "0.2.1"
