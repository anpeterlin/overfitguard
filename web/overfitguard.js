/*
 * OverfitGuard — browser audit engine (pure JavaScript, no dependencies).
 *
 * A faithful port of the Python library's core (core.py): Deflated Sharpe Ratio
 * (Bailey & Lopez de Prado, 2014) + a sealed out-of-sample holdout. Runs entirely
 * in the browser so a strategy's returns never leave the user's machine.
 *
 * Parity with the Python library is verified in _parity/ — the normal quantile
 * uses Wichura's AS 241 (the same algorithm as Python's statistics.NormalDist),
 * and skew/kurtosis replicate pandas' bias-corrected estimators exactly.
 *
 * Works as a browser global (window.OverfitGuard) or a CommonJS module.
 */
(function (root) {
  "use strict";

  var EULER_GAMMA = 0.5772156649015329;
  var TRADING_DAYS = 252;
  var SQRT2 = Math.SQRT2;

  // ---- normal CDF (Abramowitz & Stegun 7.1.26 erf, |err| < 1.5e-7) ----
  function erf(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x));
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  function normCdf(x) { return 0.5 * (1 + erf(x / SQRT2)); }

  // ---- normal inverse CDF: Wichura AS 241 (ports CPython statistics.inv_cdf) ----
  function normInvCdf(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var q = p - 0.5, r, num, den;
    if (Math.abs(q) <= 0.425) {
      r = 0.180625 - q * q;
      num = (((((((2.5090809287301226727e3 * r + 3.3430575583588128105e4) * r + 6.7265770927008700853e4) * r
        + 4.5921953931549871457e4) * r + 1.3731693765509461125e4) * r + 1.9715909503065514427e3) * r
        + 1.3314166789178437745e2) * r + 3.3871328727963666080e0) * q;
      den = (((((((5.2264952788528545610e3 * r + 2.8729085735721942674e4) * r + 3.9307895800092710610e4) * r
        + 2.1213794301586595867e4) * r + 5.3941960214247511077e3) * r + 6.8718700749205790830e2) * r
        + 4.2313330701600911252e1) * r + 1.0);
      return num / den;
    }
    r = (q <= 0) ? p : 1 - p;
    r = Math.sqrt(-Math.log(r));
    if (r <= 5.0) {
      r = r - 1.6;
      num = (((((((7.74545014278341407640e-4 * r + 0.0227238449892691845833) * r + 0.241780725177450611770) * r
        + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.76949722146069140550) * r
        + 4.63033784615654529590) * r + 1.42343711074968357734);
      den = (((((((1.05075007164441684324e-9 * r + 5.47593808499534494600e-4) * r + 0.0151986665636164571966) * r
        + 0.148103976427480074590) * r + 0.689767334985100004550) * r + 1.67638483018380384940) * r
        + 2.05319162663775882187) * r + 1.0);
    } else {
      r = r - 5.0;
      num = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r
        + 0.0265321895265761230930) * r + 0.296560571828504891230) * r + 1.78482653991729133580) * r
        + 5.46378491116411436990) * r + 6.65790464350110377720);
      den = (((((((2.04426310338993978564e-15 * r + 1.42151175831644588870e-7) * r + 1.84631831751005468180e-5) * r
        + 7.86869131145613259100e-4) * r + 0.0148753612908506148525) * r + 0.136929880922735805310) * r
        + 0.599832206555887937690) * r + 1.0);
    }
    var x = num / den;
    return q < 0 ? -x : x;
  }

  // ---- basic stats ----
  function clean(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = Number(arr[i]);
      if (isFinite(v)) out.push(v);
    }
    return out;
  }
  function mean(a) {
    var s = 0; for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }
  function stdDdof1(a) {
    var n = a.length; if (n < 2) return 0;
    var m = mean(a), s = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; s += d * d; }
    return Math.sqrt(s / (n - 1));
  }
  // pandas Series.skew(): adjusted Fisher-Pearson standardized moment coefficient.
  function pandasSkew(a) {
    var n = a.length; if (n < 3) return NaN;
    var m = mean(a), m2 = 0, m3 = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; var d2 = d * d; m2 += d2; m3 += d2 * d; }
    if (m2 === 0) return 0;
    return (n * Math.sqrt(n - 1) / (n - 2)) * (m3 / Math.pow(m2, 1.5));
  }
  // pandas Series.kurt(): bias-corrected EXCESS kurtosis (normal -> 0).
  function pandasKurtExcess(a) {
    var n = a.length; if (n < 4) return NaN;
    var m = mean(a), m2 = 0, m4 = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; var d2 = d * d; m2 += d2; m4 += d2 * d2; }
    if (m2 === 0) return 0;
    var adj = 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
    var numerator = n * (n + 1) * (n - 1) * m4;
    var denominator = (n - 2) * (n - 3) * m2 * m2;
    return numerator / denominator - adj;
  }

  function perPeriodSharpe(r) {
    if (r.length < 2) return 0;
    // A constant (zero-variance) series carries no risk-adjusted signal. Guard on the range (max ===
    // min) rather than the computed std: float rounding leaves the std of an effectively-constant
    // series at a tiny non-zero value, which would blow mean/std up to a spurious ~1e17 "infinite
    // Sharpe". Matches the Python library's np.ptp(r) == 0 guard, so a flat line -> Sharpe 0 in both.
    var lo = r[0], hi = r[0];
    for (var i = 1; i < r.length; i++) { if (r[i] < lo) lo = r[i]; else if (r[i] > hi) hi = r[i]; }
    if (hi === lo) return 0;
    var sd = stdDdof1(r);
    return sd > 0 ? mean(r) / sd : 0;
  }
  function annualizedSharpe(r, ppy) {
    ppy = ppy || TRADING_DAYS;
    return perPeriodSharpe(clean(r)) * Math.sqrt(ppy);
  }

  // Variance of the per-period Sharpe estimator (kurt is NON-excess: normal = 3).
  function srEstimatorVariance(sr, n, skew, kurt) {
    if (n < 2) return Infinity;
    return (1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr) / (n - 1);
  }

  function expectedMaxSharpe(nTrials, srSd) {
    if (nTrials <= 1) return 0;
    var cap = 1.0 - 1e-15;
    var z1 = normInvCdf(Math.min(1.0 - 1.0 / nTrials, cap));
    var z2 = normInvCdf(Math.min(1.0 - 1.0 / (nTrials * Math.E), cap));
    return srSd * ((1.0 - EULER_GAMMA) * z1 + EULER_GAMMA * z2);
  }

  function deflatedSharpeRatio(returns, nTrials, ppy) {
    ppy = ppy || TRADING_DAYS;
    var r = clean(returns), n = r.length;
    if (n < 3) return 0;
    var srPp = perPeriodSharpe(r);
    var skew = pandasSkew(r);
    var kurt = pandasKurtExcess(r) + 3.0;
    var vr = srEstimatorVariance(srPp, n, skew, kurt);
    if (!isFinite(vr) || vr <= 0) return 0;
    var srStarPp = expectedMaxSharpe(Math.max(Math.trunc(nTrials), 1), Math.sqrt(vr));
    return normCdf((srPp - srStarPp) / Math.sqrt(vr));
  }

  function probabilisticSharpeRatio(returns, srStar, ppy) {
    srStar = srStar || 0.0; ppy = ppy || TRADING_DAYS;
    var r = clean(returns), n = r.length;
    if (n < 3) return 0;
    var srPp = perPeriodSharpe(r);
    var skew = pandasSkew(r);
    var kurt = pandasKurtExcess(r) + 3.0;
    var vr = srEstimatorVariance(srPp, n, skew, kurt);
    if (!isFinite(vr) || vr <= 0) return 0;
    var srStarPp = srStar / Math.sqrt(ppy);
    return normCdf((srPp - srStarPp) / Math.sqrt(vr));
  }

  // Python's round(): round-half-to-even, operating on the IEEE-754 double.
  function pyRound(x) {
    var f = Math.floor(x), d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1;
  }

  function validate(returns, opts) {
    opts = opts || {};
    var nTrials = opts.nTrials == null ? 1 : opts.nTrials;
    var holdoutFrac = opts.holdoutFrac == null ? 0.35 : opts.holdoutFrac;
    var ppy = opts.periodsPerYear == null ? TRADING_DAYS : opts.periodsPerYear;
    var benchmark = opts.benchmark == null ? null : opts.benchmark;

    var r = clean(returns), notes = [];
    if (r.length < 60) {
      return {
        verdict: "INSUFFICIENT_DATA", deflatedSharpe: 0, fullSharpe: 0, inSampleSharpe: 0,
        outOfSampleSharpe: 0, oosRetention: 0, nTrials: Math.trunc(nTrials), nPeriods: r.length,
        holdoutFrac: holdoutFrac, benchmarkSharpe: null, beatsBenchmarkOos: null,
        notes: ["Need >= 60 periods to say anything honest."]
      };
    }

    var split = pyRound(r.length * (1.0 - holdoutFrac));
    split = Math.min(Math.max(split, 30), r.length - 30);
    var isR = r.slice(0, split), oosR = r.slice(split);

    var dsr = deflatedSharpeRatio(r, nTrials, ppy);
    var fullSr = annualizedSharpe(r, ppy);
    var isSr = annualizedSharpe(isR, ppy);
    var oosSr = annualizedSharpe(oosR, ppy);
    var retention = isSr > 0 ? oosSr / isSr : (oosSr <= 0 ? 0 : 1);

    var benchSr = null, beatsOos = null;
    if (benchmark != null) {
      var b = clean(benchmark);
      if (b.length >= r.length) {
        benchSr = annualizedSharpe(b, ppy);
        beatsOos = annualizedSharpe(b.slice(split), ppy) < oosSr;
      }
    }

    var deflationOk = dsr >= 0.95;
    var oosAlive = oosSr > 0;
    var oosHolds = oosSr >= 0.5 * isSr;

    var verdict;
    if (!oosAlive) {
      verdict = "FAILS_OUT_OF_SAMPLE";
      notes.push("The edge vanishes (or reverses) on data the search never saw — the classic mirage.");
    } else if (deflationOk && oosHolds) {
      verdict = "LIKELY_REAL";
      notes.push("Survives deflation for the trials tried AND holds up out-of-sample.");
    } else if (deflationOk) {
      verdict = "SURVIVES_DEFLATION_BUT_DECAYS_OOS";
      notes.push("Significant after deflation, but the edge shrinks out-of-sample — treat with caution.");
    } else if (dsr < 0.5) {
      verdict = "LIKELY_OVERFIT";
      notes.push("A search of " + Math.trunc(nTrials) + " trials would throw up a Sharpe this good by luck; "
        + "deflated probability is only " + (dsr * 100).toFixed(1) + "%.");
    } else {
      verdict = "INCONCLUSIVE";
      notes.push("Out-of-sample is positive, but at " + (dsr * 100).toFixed(1) + "% deflated confidence the "
        + "record is too short / the Sharpe too modest to prove real for the trials tried — promising, not "
        + "proven. Collect more track record before trusting it.");
    }
    if (benchmark != null && beatsOos === false) {
      notes.push("Does NOT beat the benchmark out-of-sample — even if 'real', it isn't worth trading.");
    }

    return {
      verdict: verdict, deflatedSharpe: dsr, fullSharpe: fullSr, inSampleSharpe: isSr,
      outOfSampleSharpe: oosSr, oosRetention: retention, nTrials: Math.trunc(nTrials),
      nPeriods: r.length, holdoutFrac: holdoutFrac, benchmarkSharpe: benchSr,
      beatsBenchmarkOos: beatsOos, notes: notes
    };
  }

  // ---- multi-candidate screener: White's Reality Check (screen.py) ----
  // Deterministic parts (means, best, statistic, Sharpe) match the Python library exactly; the
  // bootstrap p-value uses randomness, so it agrees on verdict and lands within Monte-Carlo error
  // of Python's (a seeded JS RNG, since numpy's PCG64 stream can't be reproduced in the browser).
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function blockBootstrapIndex(n, block, rnd) {
    var out = new Array(n), filled = 0;
    while (filled < n) {
      var start = Math.floor(rnd() * n);
      var take = Math.min(block, n - filled);
      for (var i = 0; i < take; i++) out[filled + i] = (start + i) % n;
      filled += take;
    }
    return out;
  }
  // candidates: { name: [returns...] }. Rows with any non-finite value across candidates are dropped.
  function screen(candidates, opts) {
    opts = opts || {};
    var nBootstrap = opts.nBootstrap == null ? 1000 : opts.nBootstrap;
    var block = Math.max(Math.trunc(opts.block == null ? 20 : opts.block), 1);
    var ppy = opts.periodsPerYear == null ? TRADING_DAYS : opts.periodsPerYear;
    var seed = (opts.seed == null ? 0 : opts.seed) >>> 0;

    var names = Object.keys(candidates), k = names.length;
    var cols = names.map(function (nm) { return candidates[nm].map(Number); });
    var nRaw = k ? Math.min.apply(null, cols.map(function (c) { return c.length; })) : 0;
    var F = [];
    for (var t = 0; t < nRaw; t++) {
      var row = new Array(k), ok = true;
      for (var j = 0; j < k; j++) { var v = cols[j][t]; if (!isFinite(v)) { ok = false; break; } row[j] = v; }
      if (ok) F.push(row);
    }
    var n = F.length;
    if (n < 60 || k < 1) {
      return { verdict: "INSUFFICIENT_DATA", bestName: "", realityCheckPValue: 1.0, bestMeanAnnual: 0,
        bestSharpeAnnual: 0, nCandidates: k, nPeriods: n, nBootstrap: nBootstrap, block: block };
    }
    var means = new Array(k).fill(0), i, j;
    for (t = 0; t < n; t++) for (j = 0; j < k; j++) means[j] += F[t][j];
    for (j = 0; j < k; j++) means[j] /= n;
    var stds = new Array(k).fill(0);
    for (t = 0; t < n; t++) for (j = 0; j < k; j++) { var d = F[t][j] - means[j]; stds[j] += d * d; }
    for (j = 0; j < k; j++) stds[j] = Math.sqrt(stds[j] / (n - 1));
    var best = 0; for (j = 1; j < k; j++) if (means[j] > means[best]) best = j;
    var vObs = Math.sqrt(n) * means[best];

    var rnd = mulberry32(seed), ge = 0;
    for (var b = 0; b < nBootstrap; b++) {
      var idx = blockBootstrapIndex(n, block, rnd);
      var vmax = -Infinity;
      for (j = 0; j < k; j++) {
        var s = 0; for (i = 0; i < n; i++) s += F[idx[i]][j];
        var bm = s / n - means[j];
        if (bm > vmax) vmax = bm;
      }
      if (Math.sqrt(n) * vmax >= vObs) ge++;
    }
    var pValue = (ge + 1) / (nBootstrap + 1);
    // Gate bestSharpe on the best column's actual range too (constant column -> Sharpe 0), mirroring
    // screen.py's np.ptp guard, so float noise in stds[best] can't leak a spurious ~1e17 Sharpe.
    var bmn = F[0][best], bmx = F[0][best];
    for (i = 1; i < n; i++) { var bv = F[i][best]; if (bv < bmn) bmn = bv; if (bv > bmx) bmx = bv; }
    var bestSharpe = (bmx > bmn && stds[best] > 0) ? means[best] / stds[best] * Math.sqrt(ppy) : 0;
    return {
      verdict: pValue < 0.05 ? "BEST_IS_SIGNIFICANT" : "NO_STRATEGY_BEATS_LUCK",
      bestName: names[best], realityCheckPValue: pValue, bestMeanAnnual: means[best] * ppy,
      bestSharpeAnnual: bestSharpe, nCandidates: k, nPeriods: n, nBootstrap: nBootstrap, block: block
    };
  }

  var API = {
    validate: validate,
    screen: screen,
    deflatedSharpeRatio: deflatedSharpeRatio,
    probabilisticSharpeRatio: probabilisticSharpeRatio,
    annualizedSharpe: annualizedSharpe,
    normCdf: normCdf,
    normInvCdf: normInvCdf,
    pandasSkew: pandasSkew,
    pandasKurtExcess: pandasKurtExcess,
    TRADING_DAYS: TRADING_DAYS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OverfitGuard = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
