"use strict";
// Standalone JS regression gate for the degenerate-input (zero-variance) guard. No Python needed:
// sweeps constant series through validate() and screen() and exits non-zero on any leaked ~1e17
// Sharpe, and asserts a near-constant series still computes a normal finite Sharpe (no over-trigger).
// Run: node web/_parity/check_degenerate.js
const path = require("path");
const OG = require(path.join(__dirname, "..", "overfitguard.js"));
const N = 200000, M = 20000, LEN = 220;
let v = 0; for (let i = 0; i < N; i++) { const c = -0.01 + 0.02 * i / (N - 1);
  if (Math.abs(OG.validate(new Array(LEN).fill(c)).fullSharpe) > 1e-9) v++; }
let s = 0; for (let i = 0; i < M; i++) { const c = -0.01 + 0.02 * i / (M - 1);
  const r = OG.screen({ flat: new Array(120).fill(c), lower: new Array(120).fill(c - 0.05) }, { nBootstrap: 1 });
  if (r.bestName === "flat" && Math.abs(r.bestSharpeAnnual) > 1e-9) s++; }
const near = new Array(LEN).fill(0.001); near[100] = 0.001 + 1e-7;
const ns = OG.validate(near).fullSharpe;
if (v || s || !(isFinite(ns) && ns !== 0)) {
  console.error(`FAIL validate=${v}/${N} screen=${s}/${M} near=${ns}`); process.exit(1);
}
console.log(`OK: ${N}+${M} constants -> Sharpe 0; near-constant computes (${ns.toFixed(2)}).`);
