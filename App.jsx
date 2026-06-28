import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ============================================================================
   NF CryptoMarket — practice & market-research terminal (v2)
   • Every Binance USDT pair, auto-listed + searchable
   • 18 indicators (10 overlays + 8 oscillators)
   • Interactive chart drawing: trendline, ray/projection, level, rectangle
   • Paper trading only. No real money, ever.
   ========================================================================== */

const API = "https://api.binance.com/api/v3";
const START_BALANCE = 10000;
const STORE_KEY = "nf_cryptomarket_v2";
const FEE = 0.001;

const TIMEFRAMES = [
  { id: "1m", label: "1m" }, { id: "5m", label: "5m" }, { id: "15m", label: "15m" },
  { id: "1h", label: "1h" }, { id: "4h", label: "4h" }, { id: "1d", label: "1D" },
];

const FALLBACK = [
  { sym: "BTCUSDT", base: "BTC", price: 95000, vol: 9e9 }, { sym: "ETHUSDT", base: "ETH", price: 3500, vol: 6e9 },
  { sym: "SOLUSDT", base: "SOL", price: 150, vol: 3e9 }, { sym: "BNBUSDT", base: "BNB", price: 600, vol: 2e9 },
  { sym: "XRPUSDT", base: "XRP", price: 2.2, vol: 2e9 }, { sym: "DOGEUSDT", base: "DOGE", price: 0.35, vol: 1e9 },
  { sym: "ADAUSDT", base: "ADA", price: 0.9, vol: 9e8 }, { sym: "AVAXUSDT", base: "AVAX", price: 35, vol: 7e8 },
  { sym: "LINKUSDT", base: "LINK", price: 22, vol: 6e8 }, { sym: "LTCUSDT", base: "LTC", price: 100, vol: 5e8 },
  { sym: "DOTUSDT", base: "DOT", price: 7, vol: 4e8 }, { sym: "MATICUSDT", base: "MATIC", price: 0.5, vol: 4e8 },
];

const dpFor = (p) => p >= 100 ? 2 : p >= 1 ? 3 : p >= 0.1 ? 4 : p >= 0.001 ? 5 : 7;
const volReadable = (v) => v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(0);

/* ============================ indicator math ============================== */
const rollMax = (a, p) => a.map((_, i) => i < p - 1 ? null : Math.max(...a.slice(i - p + 1, i + 1)));
const rollMin = (a, p) => a.map((_, i) => i < p - 1 ? null : Math.min(...a.slice(i - p + 1, i + 1)));
function sma(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; }
function ema(v, p) { const o = Array(v.length).fill(null); const k = 2 / (p + 1); let pr = null; for (let i = 0; i < v.length; i++) { if (v[i] == null) { o[i] = pr; continue; } pr = pr == null ? v[i] : v[i] * k + pr * (1 - k); o[i] = pr; } return o; }
function rsi(c, p = 14) { const o = Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0); if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; o[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } } return o; }
function macd(c, f = 12, s = 26, sg = 9) { const ef = ema(c, f), es = ema(c, s); const line = c.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null); const sig = ema(line.map(x => x == null ? 0 : x), sg).map((x, i) => line[i] == null ? null : x); const hist = line.map((x, i) => x != null && sig[i] != null ? x - sig[i] : null); return { line, sig, hist }; }
function vwap(cs) { const o = Array(cs.length).fill(null); let pv = 0, vv = 0; for (let i = 0; i < cs.length; i++) { const c = cs[i], tp = (c.h + c.l + c.c) / 3; pv += tp * c.v; vv += c.v; o[i] = vv > 0 ? pv / vv : null; } return o; }
function boll(c, p = 20, m = 2) { const mid = sma(c, p), up = Array(c.length).fill(null), lo = Array(c.length).fill(null); for (let i = p - 1; i < c.length; i++) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2; const sd = Math.sqrt(s / p); up[i] = mid[i] + m * sd; lo[i] = mid[i] - m * sd; } return { mid, up, lo }; }
function donchian(hi, lo, p = 20) { const u = rollMax(hi, p), l = rollMin(lo, p); return { up: u, lo: l, mid: u.map((x, i) => x != null && l[i] != null ? (x + l[i]) / 2 : null) }; }
function atr(hi, lo, cl, p = 14) { const tr = hi.map((h, i) => i === 0 ? h - lo[i] : Math.max(h - lo[i], Math.abs(h - cl[i - 1]), Math.abs(lo[i] - cl[i - 1]))); const o = Array(hi.length).fill(null); let a = null; for (let i = 0; i < tr.length; i++) { if (i < p) { if (i === p - 1) { a = tr.slice(0, p).reduce((x, y) => x + y, 0) / p; o[i] = a; } } else { a = (a * (p - 1) + tr[i]) / p; o[i] = a; } } return o; }
function stoch(hi, lo, cl, p = 14, d = 3) { const hh = rollMax(hi, p), ll = rollMin(lo, p); const k = cl.map((c, i) => hh[i] != null && hh[i] !== ll[i] ? 100 * (c - ll[i]) / (hh[i] - ll[i]) : (hh[i] != null ? 50 : null)); const dd = sma(k.map(x => x == null ? 0 : x), d).map((x, i) => k[i] == null ? null : x); return { k, d: dd }; }
function obv(cl, vol) { const o = Array(cl.length).fill(0); for (let i = 1; i < cl.length; i++) o[i] = o[i - 1] + (cl[i] > cl[i - 1] ? vol[i] : cl[i] < cl[i - 1] ? -vol[i] : 0); return o; }
function willr(hi, lo, cl, p = 14) { const hh = rollMax(hi, p), ll = rollMin(lo, p); return cl.map((c, i) => hh[i] != null && hh[i] !== ll[i] ? -100 * (hh[i] - c) / (hh[i] - ll[i]) : null); }
function cci(hi, lo, cl, p = 20) { const tp = hi.map((h, i) => (h + lo[i] + cl[i]) / 3); const ma = sma(tp, p); return tp.map((t, i) => { if (ma[i] == null) return null; let md = 0; for (let j = i - p + 1; j <= i; j++) md += Math.abs(tp[j] - ma[i]); md /= p; return md === 0 ? 0 : (t - ma[i]) / (0.015 * md); }); }
function momentum(c, p = 10) { return c.map((x, i) => i < p ? null : x - c[i - p]); }
function psar(hi, lo, step = 0.02, max = 0.2) {
  const o = Array(hi.length).fill(null); if (hi.length < 2) return o;
  let up = hi[1] >= hi[0], af = step, ep = up ? hi[0] : lo[0], sar = up ? lo[0] : hi[0];
  for (let i = 1; i < hi.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) { sar = Math.min(sar, lo[i - 1], i >= 2 ? lo[i - 2] : lo[i - 1]); if (hi[i] > ep) { ep = hi[i]; af = Math.min(af + step, max); } if (lo[i] < sar) { up = false; sar = ep; ep = lo[i]; af = step; } }
    else { sar = Math.max(sar, hi[i - 1], i >= 2 ? hi[i - 2] : hi[i - 1]); if (lo[i] < ep) { ep = lo[i]; af = Math.min(af + step, max); } if (hi[i] > sar) { up = true; sar = ep; ep = hi[i]; af = step; } }
    o[i] = sar;
  }
  return o;
}

const OVERLAYS = [
  { id: "sma20", label: "SMA 20", color: "#e8b14c", fn: v => [{ d: sma(v.c, 20), color: "#e8b14c" }] },
  { id: "sma50", label: "SMA 50", color: "#4fb7d8", fn: v => [{ d: sma(v.c, 50), color: "#4fb7d8" }] },
  { id: "sma200", label: "SMA 200", color: "#f0616d", fn: v => [{ d: sma(v.c, 200), color: "#f0616d" }] },
  { id: "ema9", label: "EMA 9", color: "#bf7af0", fn: v => [{ d: ema(v.c, 9), color: "#bf7af0" }] },
  { id: "ema21", label: "EMA 21", color: "#5ad19e", fn: v => [{ d: ema(v.c, 21), color: "#5ad19e" }] },
  { id: "ema55", label: "EMA 55", color: "#f5a35c", fn: v => [{ d: ema(v.c, 55), color: "#f5a35c" }] },
  { id: "vwap", label: "VWAP", color: "#c8d0dc", fn: v => [{ d: vwap(v.cs), color: "#c8d0dc" }] },
  { id: "boll", label: "Bollinger", color: "#4fb7d8", fn: v => { const b = boll(v.c); return [{ d: b.up, color: "rgba(79,183,216,.5)" }, { d: b.mid, color: "rgba(79,183,216,.25)" }, { d: b.lo, color: "rgba(79,183,216,.5)" }]; } },
  { id: "donch", label: "Donchian", color: "#e8b14c", fn: v => { const dn = donchian(v.h, v.l); return [{ d: dn.up, color: "rgba(232,177,76,.45)" }, { d: dn.lo, color: "rgba(232,177,76,.45)" }]; } },
  { id: "psar", label: "Parabolic SAR", color: "#bf7af0", dots: true, fn: v => [{ d: psar(v.h, v.l), color: "#bf7af0", dots: true }] },
];
const OSC = [
  { id: "rsi", label: "RSI 14" }, { id: "macd", label: "MACD" }, { id: "stoch", label: "Stochastic" },
  { id: "atr", label: "ATR 14" }, { id: "obv", label: "OBV" }, { id: "willr", label: "Williams %R" },
  { id: "cci", label: "CCI 20" }, { id: "mom", label: "Momentum" },
];

/* ============================== formatting =============================== */
const fmtUsd = (n, dp = 2) => "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtNum = (n, dp = 2) => Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtSig = (n, dp = 2) => (n >= 0 ? "+" : "") + fmtNum(n, dp);

/* ============================== simulator ================================ */
function genCandles(base, n, tfMs) {
  const out = []; let price = base * (0.97 + Math.random() * 0.06); const now = Date.now(); let drift = (Math.random() - 0.5) * 0.004;
  for (let i = n - 1; i >= 0; i--) { if (Math.random() < 0.05) drift = (Math.random() - 0.5) * 0.004; const o = price; const mv = (Math.random() - 0.5) * 0.01 + drift; const c = Math.max(o * (1 + mv), base * 1e-6); const h = Math.max(o, c) * (1 + Math.random() * 0.004); const l = Math.min(o, c) * (1 - Math.random() * 0.004); out.push({ t: now - i * tfMs, o, h, l, c, v: base * (500 + Math.random() * 1500) / Math.sqrt(base) }); price = c; }
  return out;
}

/* ================================ Chart ================================== */
function Chart({ candles, dp, overlays, osc, drawings, tool, onCommit, onPick, viewKey }) {
  const wrapRef = useRef(null), baseRef = useRef(null), ovRef = useRef(null);
  const mapRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const [hover, setHover] = useState(null);
  const draftRef = useRef(null); draftRef.current = draft;

  const DEFAULT_LEN = 90, FUTURE = 0.14;
  const [vp, setVp] = useState({ off: 0, len: DEFAULT_LEN });
  const vpRef = useRef(vp); vpRef.current = vp;
  const panRef = useRef(null);
  // reset to latest when the coin or timeframe changes
  useEffect(() => { setVp({ off: 0, len: DEFAULT_LEN }); }, [viewKey]);

  const computeMap = useCallback(() => {
    const wrap = wrapRef.current; if (!wrap || !candles.length) return null;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const padL = 8, padR = 66, padT = 12, padB = 20;
    const hasLow = osc !== "none";
    const lowH = hasLow ? Math.min(116, H * 0.27) : 0;
    const priceH = H - padT - padB - (hasLow ? lowH + 16 : 0);
    const chartW = W - padL - padR;
    const total = candles.length;
    const len = Math.max(20, Math.min(vp.len, total));
    const off = Math.max(0, Math.min(vp.off, Math.max(0, total - len)));
    const start = Math.max(0, total - len - off);
    const view = candles.slice(start, start + len).filter(x => x && isFinite(x.c) && isFinite(x.h) && isFinite(x.l) && isFinite(x.o));
    const n = view.length;
    if (!n) return null;
    const c = view.map(x => x.c), h = view.map(x => x.h), l = view.map(x => x.l);
    let hi = Math.max(...h), lo = Math.min(...l);
    if (!isFinite(hi) || !isFinite(lo)) { hi = 1; lo = 0; }
    OVERLAYS.forEach(ov => { if (overlays.has(ov.id)) { try { ov.fn({ c, h, l, cs: view }).forEach(ln => ln.d.forEach(val => { if (val != null && isFinite(val)) { hi = Math.max(hi, val); lo = Math.min(lo, val); } })); } catch (e) {} } });
    if (hi <= lo) { const mid = isFinite(hi) && hi !== 0 ? hi : 1; hi = mid * 1.0005 + 1e-9; lo = mid * 0.9995 - 1e-9; }
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1; hi += pad; lo -= pad;
    const plotW = chartW * (1 - FUTURE);
    const spacing = n > 1 ? plotW / (n - 1) : plotW;
    const tLast = view[n - 1].t, tStep = n > 1 ? ((view[n - 1].t - view[n - 2].t) || 60000) : 60000;
    const xLast = padL + plotW;
    const timeToX = t => xLast + ((t - tLast) / tStep) * spacing;
    const xToTime = x => tLast + ((x - xLast) / spacing) * tStep;
    const priceToY = p => padT + (1 - (p - lo) / (hi - lo)) * priceH;
    const yToPrice = y => lo + (1 - (y - padT) / priceH) * (hi - lo);
    return { W, H, padL, padR, padT, padB, chartW, plotW, spacing, view, n, hi, lo, priceH, hasLow, lowH, c, h, l, timeToX, xToTime, priceToY, yToPrice, xLast, tLast, tStep, off, len, total };
  }, [candles, overlays, osc, vp]);

  const drawBase = useCallback(() => {
    const m = computeMap(); if (!m) return; mapRef.current = m;
    const cv = baseRef.current, wrap = wrapRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = m.W * dpr; cv.height = m.H * dpr; cv.style.width = m.W + "px"; cv.style.height = m.H + "px";
    const ovc = ovRef.current; if (ovc) { ovc.width = m.W * dpr; ovc.height = m.H * dpr; ovc.style.width = m.W + "px"; ovc.style.height = m.H + "px"; }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, m.W, m.H);
    const { view, n, hi, lo, padL, padT, priceH, chartW, plotW, priceToY, timeToX } = m;

    // future zone shading + "now" divider
    ctx.fillStyle = "rgba(255,255,255,0.012)"; ctx.fillRect(padL + plotW, padT, chartW - plotW, priceH);
    ctx.strokeStyle = "rgba(232,177,76,0.18)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL + plotW, padT); ctx.lineTo(padL + plotW, padT + priceH); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#5b6678"; ctx.font = "9px 'IBM Plex Mono',monospace"; ctx.textAlign = "center";
    ctx.fillText("NOW", padL + plotW, padT + priceH + 12);
    ctx.textAlign = "left"; ctx.fillStyle = "rgba(91,102,120,0.6)"; ctx.fillText("projection →", padL + plotW + 6, padT + 10);

    // grid + price axis
    ctx.font = "11px 'IBM Plex Mono',monospace"; ctx.textBaseline = "middle";
    for (let g = 0; g <= 4; g++) { const gy = padT + (g / 4) * priceH, gp = hi - (g / 4) * (hi - lo); ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + chartW, gy); ctx.stroke(); ctx.fillStyle = "#5b6678"; ctx.textAlign = "left"; ctx.fillText(fmtNum(gp, dp), padL + chartW + 6, gy); }

    // candles
    const cw = Math.max(1.5, m.spacing * 0.62);
    view.forEach((c, i) => { const up = c.c >= c.o, col = up ? "#2ebd85" : "#f0616d", cx = timeToX(c.t); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, priceToY(c.h)); ctx.lineTo(cx, priceToY(c.l)); ctx.stroke(); const yo = priceToY(c.o), yc = priceToY(c.c); ctx.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo))); });

    // overlays
    const cArr = view.map(x => x.c), hArr = view.map(x => x.h), lArr = view.map(x => x.l);
    const line = (arr, color, dots) => { if (dots) { ctx.fillStyle = color; arr.forEach((v, i) => { if (v != null) { ctx.beginPath(); ctx.arc(timeToX(view[i].t), priceToY(v), 1.3, 0, 7); ctx.fill(); } }); return; } ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false; arr.forEach((v, i) => { if (v == null) return; const px = timeToX(view[i].t), py = priceToY(v); if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py); }); ctx.stroke(); };
    OVERLAYS.forEach(ov => { if (overlays.has(ov.id)) ov.fn({ c: cArr, h: hArr, l: lArr, cs: view }).forEach(ln => line(ln.d, ln.color, ln.dots)); });

    // last price tag
    const lastC = view[n - 1].c, ly = priceToY(lastC);
    ctx.strokeStyle = "rgba(232,177,76,0.55)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + plotW, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#e8b14c"; ctx.fillRect(padL + chartW, ly - 9, m.padR - 2, 18); ctx.fillStyle = "#0e1116"; ctx.textAlign = "left"; ctx.font = "bold 11px 'IBM Plex Mono',monospace"; ctx.fillText(fmtNum(lastC, dp), padL + chartW + 5, ly);

    // oscillator
    if (m.hasLow) drawOsc(ctx, m, cArr, hArr, lArr, view);
  }, [computeMap, overlays, osc, dp]);

  function drawOsc(ctx, m, c, h, l, view) {
    const lTop = m.padT + m.priceH + 16, lH = m.lowH, { padL, chartW, timeToX } = m;
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.moveTo(padL, lTop); ctx.lineTo(padL + chartW, lTop); ctx.stroke();
    ctx.font = "10px 'IBM Plex Mono',monospace"; ctx.fillStyle = "#8a94a6"; ctx.textAlign = "left";
    const vol = view.map(x => x.v);
    const plot = (arr, color, yfn, w = 1.4) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); let st = false; arr.forEach((v, i) => { if (v == null) return; const px = timeToX(view[i].t), py = yfn(v); if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py); }); ctx.stroke(); };
    const bounded = (data, mn, mx, levels, label, color) => { const yf = v => lTop + (1 - (v - mn) / (mx - mn)) * lH; (levels || []).forEach(lv => { ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(padL, yf(lv)); ctx.lineTo(padL + chartW, yf(lv)); ctx.stroke(); ctx.fillStyle = "#5b6678"; ctx.textAlign = "left"; ctx.fillText(String(lv), padL + chartW + 6, yf(lv)); }); ctx.setLineDash([]); plot(data, color, yf); ctx.fillStyle = "#8a94a6"; ctx.fillText(label, padL + 2, lTop + 10); };
    const auto = (arrs, label, colors, hist) => { let mx = -Infinity, mn = Infinity; arrs.forEach(a => a.forEach(v => { if (v != null) { mx = Math.max(mx, v); mn = Math.min(mn, v); } })); if (mx === mn) { mx += 1; mn -= 1; } const pad = (mx - mn) * 0.1; mx += pad; mn -= pad; const yf = v => lTop + (1 - (v - mn) / (mx - mn)) * lH; if (mn < 0 && mx > 0) { ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.beginPath(); ctx.moveTo(padL, yf(0)); ctx.lineTo(padL + chartW, yf(0)); ctx.stroke(); } if (hist) { const bw = Math.max(1, m.spacing * 0.5); hist.forEach((v, i) => { if (v == null) return; ctx.fillStyle = v >= 0 ? "rgba(46,189,133,.55)" : "rgba(240,97,109,.55)"; const py = yf(v), zy = yf(0); ctx.fillRect(timeToX(view[i].t) - bw / 2, Math.min(py, zy), bw, Math.max(1, Math.abs(py - zy))); }); } arrs.forEach((a, i) => plot(a, colors[i], yf)); ctx.fillStyle = "#8a94a6"; ctx.fillText(label, padL + 2, lTop + 10); };

    if (osc === "rsi") bounded(rsi(c), 0, 100, [30, 50, 70], "RSI 14", "#bf7af0");
    else if (osc === "stoch") { const s = stoch(h, l, c); bounded(s.k, 0, 100, [20, 80], "Stoch %K/%D", "#4fb7d8"); plot(s.d, "#e8b14c", v => lTop + (1 - v / 100) * lH); }
    else if (osc === "willr") bounded(willr(h, l, c), -100, 0, [-20, -80], "Williams %R", "#4fb7d8");
    else if (osc === "macd") { const md = macd(c); auto([md.line, md.sig], "MACD 12 26 9", ["#4fb7d8", "#e8b14c"], md.hist); }
    else if (osc === "atr") auto([atr(h, l, c)], "ATR 14", ["#5ad19e"]);
    else if (osc === "obv") auto([obv(c, vol)], "OBV", ["#bf7af0"]);
    else if (osc === "cci") bounded(cci(h, l, c), -200, 200, [-100, 0, 100], "CCI 20", "#f5a35c");
    else if (osc === "mom") auto([momentum(c)], "Momentum 10", ["#4fb7d8"]);
  }

  const drawOverlay = useCallback(() => {
    const m = mapRef.current, ovc = ovRef.current; if (!m || !ovc) return;
    const dpr = window.devicePixelRatio || 1; const ctx = ovc.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, m.W, m.H);
    const all = draftRef.current ? [...drawings, draftRef.current] : drawings;
    all.forEach(d => {
      const ax = m.timeToX(d.a.t), ay = m.priceToY(d.a.price);
      ctx.lineWidth = 1.5; ctx.strokeStyle = d.color || "#e8b14c"; ctx.fillStyle = (d.color || "#e8b14c") + "18";
      if (d.type === "hline") { ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(m.padL, ay); ctx.lineTo(m.padL + m.chartW, ay); ctx.stroke(); ctx.fillStyle = d.color || "#e8b14c"; ctx.font = "10px 'IBM Plex Mono',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(fmtNum(d.a.price, dp), m.padL + 4, ay - 2); return; }
      const bx = m.timeToX(d.b.t), by = m.priceToY(d.b.price);
      if (d.type === "rect") { ctx.setLineDash([]); ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); return; }
      if (d.type === "ray") { const dx = bx - ax, dy = by - ay; const rightX = m.padL + m.chartW; const t = dx !== 0 ? (rightX - ax) / dx : 0; const endX = dx !== 0 ? rightX : bx; const endY = dx !== 0 ? ay + dy * t : by; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(endX, endY); ctx.stroke(); ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]); return; }
      // trendline
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      [[ax, ay], [bx, by]].forEach(([px, py]) => { ctx.beginPath(); ctx.arc(px, py, 2.5, 0, 7); ctx.fill(); ctx.stroke(); });
    });
    // crosshair
    if (hover && tool !== "none") {
      ctx.strokeStyle = "rgba(200,208,220,0.25)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hover.x, m.padT); ctx.lineTo(hover.x, m.padT + m.priceH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m.padL, hover.y); ctx.lineTo(m.padL + m.chartW, hover.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#2a323e"; ctx.fillRect(m.padL + m.chartW, hover.y - 9, m.padR - 2, 18); ctx.fillStyle = "#c8d0dc"; ctx.font = "10px 'IBM Plex Mono',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(fmtNum(m.yToPrice(hover.y), dp), m.padL + m.chartW + 5, hover.y);
    }
  }, [drawings, hover, tool, dp]);

  useEffect(() => { try { drawBase(); drawOverlay(); } catch (e) {} }, [drawBase]);
  useEffect(() => { try { drawOverlay(); } catch (e) {} }, [drawOverlay]);
  useEffect(() => { const r = () => { try { drawBase(); drawOverlay(); } catch (e) {} }; window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [drawBase, drawOverlay]);
  // wheel to zoom (native listener so we can preventDefault)
  useEffect(() => {
    const el = ovRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const total = candles.length || 1;
      setVp(v => { const factor = e.deltaY < 0 ? 0.82 : 1.22; let len = Math.round(v.len * factor); len = Math.max(20, Math.min(len, total)); const off = Math.max(0, Math.min(v.off, Math.max(0, total - len))); return { off, len }; });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [candles.length]);

  const evtPt = (e) => { const m = mapRef.current, ovc = ovRef.current; if (!m || !ovc) return null; const r = ovc.getBoundingClientRect(); const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top; return { x: cx, y: cy, t: m.xToTime(cx), price: m.yToPrice(cy) }; };
  const clientX = (e) => (e.touches ? e.touches[0].clientX : e.clientX);
  const down = (e) => {
    if (tool === "none") { const m = mapRef.current; panRef.current = { x: clientX(e), off0: vpRef.current.off, spacing: m ? m.spacing : 8 }; return; }
    const p = evtPt(e); if (!p) return; e.preventDefault();
    if (tool === "hline") { onCommit({ id: Date.now(), type: "hline", a: { t: p.t, price: p.price }, b: { t: p.t, price: p.price }, color: "#e8b14c" }); return; }
    setDraft({ id: Date.now(), type: tool, a: { t: p.t, price: p.price }, b: { t: p.t, price: p.price }, color: toolColor(tool) });
  };
  const move = (e) => {
    if (panRef.current) { const dx = clientX(e) - panRef.current.x; const dC = Math.round(dx / (panRef.current.spacing || 8)); setVp(v => { const total = candles.length; const len = Math.max(20, Math.min(v.len, total)); const off = Math.max(0, Math.min(panRef.current.off0 + dC, Math.max(0, total - len))); return { ...v, off }; }); return; }
    const p = evtPt(e); if (!p) return; setHover(p); if (draftRef.current) setDraft(d => ({ ...d, b: { t: p.t, price: p.price } }));
  };
  const up = () => { if (panRef.current) { panRef.current = null; return; } if (draftRef.current) { onCommit(draftRef.current); setDraft(null); } };
  const leave = () => { panRef.current = null; setHover(null); };
  const dbl = () => setVp({ off: 0, len: DEFAULT_LEN });

  return (
    <div ref={wrapRef} className="chartwrap">
      <canvas ref={baseRef} className="cbase" />
      <canvas ref={ovRef} className={"covl tool-" + tool}
        onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={leave} onDoubleClick={dbl}
        onTouchStart={down} onTouchMove={move} onTouchEnd={up} />
      <div className="chart-hint">{tool === "none" ? "drag to pan · scroll to zoom · double-click to reset" : "drawing mode — pick the cursor to pan"}</div>
    </div>
  );
}
const toolColor = t => t === "ray" ? "#bf7af0" : t === "rect" ? "#4fb7d8" : "#e8b14c";

/* ============================== Order book =============================== */
function OrderBook({ price, dp }) {
  const rows = useMemo(() => { const asks = [], bids = []; let cu = 0; for (let i = 1; i <= 8; i++) { asks.push({ p: price * (1 + i * 0.0007 * (0.7 + Math.random() * 0.6)), s: Math.random() * 4 + 0.2, c: (cu += Math.random() * 4 + 0.2) }); } cu = 0; for (let i = 1; i <= 8; i++) { bids.push({ p: price * (1 - i * 0.0007 * (0.7 + Math.random() * 0.6)), s: Math.random() * 4 + 0.2, c: (cu += Math.random() * 4 + 0.2) }); } const mx = Math.max(...asks.map(a => a.c), ...bids.map(b => b.c)); return { asks: asks.reverse(), bids, mx }; }, [Math.round(price * 100)]);
  return (
    <div className="book">
      {rows.asks.map((a, i) => <div className="brow" key={"a" + i}><div className="bd ask" style={{ width: (a.c / rows.mx) * 100 + "%" }} /><span className="bp neg">{fmtNum(a.p, dp)}</span><span className="bs">{a.s.toFixed(3)}</span></div>)}
      <div className="bmid">{fmtNum(price, dp)}<span>illustrative depth</span></div>
      {rows.bids.map((b, i) => <div className="brow" key={"b" + i}><div className="bd bid" style={{ width: (b.c / rows.mx) * 100 + "%" }} /><span className="bp pos">{fmtNum(b.p, dp)}</span><span className="bs">{b.s.toFixed(3)}</span></div>)}
    </div>
  );
}

/* ================================= App =================================== */
function Terminal({ focusSymbol }) {
  const [coins, setCoins] = useState(FALLBACK.map(c => ({ ...c, base: c.base, dp: dpFor(c.price), change: 0 })));
  const [priceMap, setPriceMap] = useState(() => { const m = {}; FALLBACK.forEach(c => m[c.sym] = c.price); return m; });
  const [selected, setSelected] = useState("BTCUSDT");
  const [tf, setTf] = useState("15m");
  const [candles, setCandles] = useState([]);
  const [dataMode, setDataMode] = useState("connecting");
  const [search, setSearch] = useState("");
  const [overlays, setOverlays] = useState(new Set(["ema21", "vwap"]));
  const [osc, setOsc] = useState("rsi");
  const [indMenu, setIndMenu] = useState(false);
  const [tool, setTool] = useState("none");
  const [drawings, setDrawings] = useState({});
  const [tab, setTab] = useState("positions");
  const [intro, setIntro] = useState(true);
  const [orderUsd, setOrderUsd] = useState("500");
  const [account, setAccount] = useState({ balance: START_BALANCE, positions: [], history: [] });
  const [loaded, setLoaded] = useState(false);
  const liveRef = useRef(false);
  const tfRef = useRef(tf); tfRef.current = tf;
  const selRef = useRef(selected); selRef.current = selected;

  const coin = useMemo(() => coins.find(c => c.sym === selected) || coins[0], [coins, selected]);
  useEffect(() => { if (focusSymbol) setSelected(focusSymbol); }, [focusSymbol]);

  /* ---- persisted account ---- */
  useEffect(() => { let on = true; (async () => { try { if (window.storage) { const r = await window.storage.get(STORE_KEY); if (on && r && r.value) { const a = JSON.parse(r.value); if (a && typeof a.balance === "number") setAccount(a); if (a && a.drawings) setDrawings(a.drawings); } } } catch (e) {} if (on) setLoaded(true); })(); return () => { on = false; }; }, []);
  useEffect(() => { if (!loaded) return; (async () => { try { if (window.storage) await window.storage.set(STORE_KEY, JSON.stringify({ ...account, drawings })); } catch (e) {} })(); }, [account, drawings, loaded]);

  /* ---- load universe (all USDT pairs) ---- */
  useEffect(() => {
    let on = true;
    const wt = (pr, ms) => Promise.race([pr, new Promise((_, r) => setTimeout(() => r(new Error("t")), ms))]);
    (async () => {
      try {
        const [info, tick] = await wt(Promise.all([fetch(API + "/exchangeInfo").then(r => r.json()), fetch(API + "/ticker/24hr").then(r => r.json())]), 6000);
        if (!on) return;
        const tm = {}; tick.forEach(t => tm[t.symbol] = t);
        const list = info.symbols.filter(s => s.quoteAsset === "USDT" && s.status === "TRADING" && !/(UP|DOWN|BULL|BEAR)USDT$/.test(s.symbol))
          .map(s => { const t = tm[s.symbol] || {}; const price = +t.lastPrice || 0; return { sym: s.symbol, base: s.baseAsset, price, change: +t.priceChangePercent || 0, vol: +t.quoteVolume || 0, dp: dpFor(price || 1) }; })
          .filter(c => c.price > 0).sort((a, b) => b.vol - a.vol);
        if (list.length > 20) { const pm = {}; list.forEach(c => pm[c.sym] = c.price); setCoins(list); setPriceMap(pm); liveRef.current = true; setDataMode("live"); if (!list.find(c => c.sym === selRef.current)) setSelected(list[0].sym); return; }
        throw new Error("empty");
      } catch (e) { liveRef.current = false; setDataMode("sim"); }
    })();
    return () => { on = false; };
  }, []);

  /* ---- load candles for selected coin / tf ---- */
  useEffect(() => {
    let on = true;
    const tfMsMap = { "1m": 60000, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
    (async () => {
      if (liveRef.current) {
        try { const raw = await fetch(`${API}/klines?symbol=${selected}&interval=${tf}&limit=500`).then(r => r.json()); if (!on) return; if (Array.isArray(raw)) { setCandles(raw.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))); return; } } catch (e) {}
      }
      if (on) setCandles(genCandles(priceMap[selected] || (coin ? coin.price : 100), 320, tfMsMap[tf]));
    })();
    return () => { on = false; };
  }, [selected, tf]);

  /* ---- live price polling (all coins) + selected candle update ---- */
  useEffect(() => {
    const tfMsMap = { "1m": 60000, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
    const id = setInterval(async () => {
      if (liveRef.current) {
        try {
          const all = await fetch(API + "/ticker/price").then(r => r.json());
          const pm = {}; all.forEach(x => pm[x.symbol] = +x.price);
          setPriceMap(prev => ({ ...prev, ...pm }));
          const np = pm[selRef.current];
          if (np) setCandles(prev => { if (!prev.length) return prev; const a = prev.slice(); const last = { ...a[a.length - 1] }; last.c = np; last.h = Math.max(last.h, np); last.l = Math.min(last.l, np); a[a.length - 1] = last; return a; });
        } catch (e) {}
      } else {
        const tfMs = tfMsMap[tfRef.current];
        setCandles(prev => { if (!prev.length) return prev; const a = prev.slice(); const last = { ...a[a.length - 1] }; const mv = (Math.random() - 0.5) * 0.006; const np = Math.max(last.c * (1 + mv), 1e-9); const now = Date.now(); if (now - last.t >= 6000) { a.push({ t: now, o: last.c, h: Math.max(last.c, np), l: Math.min(last.c, np), c: np, v: last.v * (0.6 + Math.random() * 0.8) }); if (a.length > 520) a.shift(); } else { last.c = np; last.h = Math.max(last.h, np); last.l = Math.min(last.l, np); a[a.length - 1] = last; } setPriceMap(p => ({ ...p, [selRef.current]: np })); return a; });
      }
    }, liveRef.current ? 3000 : 1500);
    return () => clearInterval(id);
  }, [dataMode]);

  const livePrice = priceMap[selected] || (coin ? coin.price : 0);

  const equity = useMemo(() => { let u = 0; account.positions.forEach(p => { const cur = priceMap[p.sym] || p.entry; u += p.side === "long" ? (cur - p.entry) * p.qty : (p.entry - cur) * p.qty; }); return account.balance + u; }, [account, priceMap]);

  /* ---- trading ---- */
  const order = (side) => { const usd = parseFloat(orderUsd); if (!usd || usd <= 0) return; const price = livePrice; if (!price) return; const cost = usd * (1 + FEE); if (cost > account.balance) return; const qty = usd / price; setAccount(a => ({ ...a, balance: a.balance - cost, positions: [...a.positions, { id: Date.now() + "-" + Math.random().toString(36).slice(2, 6), sym: selected, side, qty, entry: price, cost, opened: Date.now() }] })); };
  const closePos = (id) => setAccount(a => { const p = a.positions.find(x => x.id === id); if (!p) return a; const cur = priceMap[p.sym] || p.entry; const gross = p.side === "long" ? (cur - p.entry) * p.qty : (p.entry - cur) * p.qty; const net = (p.entry * p.qty + gross) * (1 - FEE); const basis = p.cost != null ? p.cost : p.entry * p.qty * (1 + FEE); return { ...a, balance: a.balance + net, positions: a.positions.filter(x => x.id !== id), history: [{ ...p, exit: cur, pnl: net - basis, closed: Date.now() }, ...a.history].slice(0, 120) }; });
  const reset = () => { if (window.confirm("Reset practice account to $10,000 and clear positions & history?")) setAccount({ balance: START_BALANCE, positions: [], history: [] }); };

  /* ---- drawings ---- */
  const symDrawings = drawings[selected] || [];
  const addDrawing = (d) => setDrawings(prev => ({ ...prev, [selected]: [...(prev[selected] || []), d] }));
  const undoDrawing = () => setDrawings(prev => ({ ...prev, [selected]: (prev[selected] || []).slice(0, -1) }));
  const clearDrawings = () => setDrawings(prev => ({ ...prev, [selected]: [] }));

  /* ---- coin list ---- */
  const filtered = useMemo(() => { const q = search.trim().toUpperCase(); if (!q) return coins.slice(0, 40); return coins.filter(c => c.base.includes(q) || c.sym.includes(q)).slice(0, 60); }, [coins, search]);

  const prevC = candles.length > 1 ? candles[candles.length - 2].c : livePrice;
  const chg = candles.length ? ((livePrice - candles[0].c) / candles[0].c) * 100 : (coin ? coin.change : 0);
  const wins = account.history.filter(h => h.pnl > 0).length;
  const winRate = account.history.length ? (wins / account.history.length) * 100 : 0;
  const realized = account.history.reduce((s, h) => s + h.pnl, 0);
  const indCount = overlays.size + (osc !== "none" ? 1 : 0);

  return (
    <div className="termview">
        {/* account bar */}
        <header className="acctbar">
          <div className="ab-title"><span className="ab-mode"><i className={"dot d-" + dataMode} />{dataMode === "live" ? `Live · ${coins.length} markets` : dataMode === "sim" ? "Simulated feed" : "Connecting…"}</span></div>
          <div className="acct">
            <div className="ai"><div className="l">Paper balance</div><div className="v">{fmtUsd(account.balance)}</div></div>
            <div className="ai"><div className="l">Equity</div><div className="v" style={{ color: equity >= START_BALANCE ? "#2ebd85" : "#f0616d" }}>{fmtUsd(equity)}</div></div>
            <div className="ai hide-sm"><div className="l">Open P&amp;L</div><div className="v" style={{ color: equity - account.balance >= 0 ? "#2ebd85" : "#f0616d" }}>{fmtSig(equity - account.balance)}</div></div>
            <button className="reset" onClick={reset}>Reset</button>
          </div>
        </header>

        {intro && <div className="intro"><div><strong>Practice tool.</strong> Every dollar here is simulated — no real money, no deposits, no withdrawals. Study charts, test indicators, mark up levels, rehearse trades. <em>Results here do not predict real-market outcomes.</em></div><button onClick={() => setIntro(false)}>Got it</button></div>}

        {/* body */}
        <div className="body">
          {/* sidebar */}
          <aside className="sidebar">
            <div className="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6678" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg><input placeholder="Search any market…" value={search} onChange={e => setSearch(e.target.value)} /></div>
            <div className="sidehead"><span>{search ? "Results" : "Top markets"}</span><span>24h</span></div>
            <div className="coinlist">
              {filtered.length === 0 ? <div className="noco">No market matches “{search}”.</div> : filtered.map(c => (
                <button key={c.sym} className={"coin" + (c.sym === selected ? " on" : "")} onClick={() => { setSelected(c.sym); setSearch(""); }}>
                  <div className="co-l"><span className="co-b">{c.base}</span><span className="co-q">/USDT</span></div>
                  <div className="co-r"><span className="co-p">{fmtNum(priceMap[c.sym] || c.price, c.dp)}</span><span className={"co-c " + (c.change >= 0 ? "pos" : "neg")}>{fmtSig(c.change, 2)}%</span></div>
                </button>
              ))}
            </div>
            <div className="sidefoot">Markets stream live from Binance public data. {coins.length} pairs available.</div>
          </aside>

          {/* chart column */}
          <main className="chartcol">
            <div className="chart-head">
              <div className="ch-id"><span className="ch-b">{coin ? coin.base : "—"}<span className="ch-q">/USDT</span></span><span className="ch-last" style={{ color: livePrice >= prevC ? "#2ebd85" : "#f0616d" }}>{fmtNum(livePrice, coin ? coin.dp : 2)}</span><span className={"ch-chg " + (chg >= 0 ? "pos" : "neg")}>{fmtSig(chg, 2)}%</span></div>
              <div className="ch-meta"><span>Vol {coin ? volReadable(coin.vol) : "—"}</span></div>
            </div>

            <div className="toolbar">
              <div className="tf-group">{TIMEFRAMES.map(t => <button key={t.id} className={"tf" + (t.id === tf ? " on" : "")} onClick={() => setTf(t.id)}>{t.label}</button>)}</div>
              <div className="tbsep" />
              <div className="ind-wrap">
                <button className={"toolbtn" + (indMenu ? " act" : "")} onClick={() => setIndMenu(v => !v)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v4h-4" /></svg>
                  Indicators{indCount ? <span className="indc">{indCount}</span> : null}
                </button>
                {indMenu && (
                  <div className="indmenu">
                    <div className="im-group">Overlays</div>
                    <div className="im-grid">{OVERLAYS.map(o => <label key={o.id} className="im-item"><input type="checkbox" checked={overlays.has(o.id)} onChange={() => setOverlays(s => { const n = new Set(s); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })} /><span className="sw" style={{ background: o.color }} />{o.label}</label>)}</div>
                    <div className="im-group">Oscillator (lower panel)</div>
                    <div className="im-grid">
                      <label className="im-item"><input type="radio" name="osc" checked={osc === "none"} onChange={() => setOsc("none")} />None</label>
                      {OSC.map(o => <label key={o.id} className="im-item"><input type="radio" name="osc" checked={osc === o.id} onChange={() => setOsc(o.id)} />{o.label}</label>)}
                    </div>
                  </div>
                )}
              </div>
              <div className="tbsep" />
              <div className="draw-group">
                {[
                  ["none", "Cursor", <path d="M5 3l14 8-6 1-2 6z" />],
                  ["trend", "Trend line", <path d="M4 20L20 4" />],
                  ["ray", "Projection ray", <g><path d="M3 21L21 9" /><path d="M14 9h7v7" /></g>],
                  ["hline", "Horizontal level", <path d="M3 12h18" />],
                  ["rect", "Rectangle", <rect x="4" y="6" width="16" height="12" rx="1" />],
                ].map(([id, label, icon]) => (
                  <button key={id} title={label} className={"toolbtn icon" + (tool === id ? " act" : "")} onClick={() => setTool(id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
                  </button>
                ))}
                <button className="toolbtn icon" title="Undo last" onClick={undoDrawing}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 015 5v1" /></svg></button>
                <button className="toolbtn icon danger" title="Clear all drawings" onClick={clearDrawings}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg></button>
              </div>
            </div>

            <Chart candles={candles} dp={coin ? coin.dp : 2} overlays={overlays} osc={osc} drawings={symDrawings} tool={tool} onCommit={addDrawing} viewKey={selected + tf} />

            {tool !== "none" && <div className="drawhint">{tool === "hline" ? "Click to drop a horizontal level." : tool === "ray" ? "Drag two points — the ray projects into the future zone. This marks YOUR scenario, not a forecast." : "Click and drag to draw. Your annotation only — not a prediction of price."}</div>}
          </main>

          {/* right column */}
          <aside className="rightcol">
            <section className="panel">
              <div className="ph">Place practice order</div>
              <div className="tp">
                <div className="tp-mkt"><span>{coin ? coin.base : "—"}/USDT</span><strong>{fmtNum(livePrice, coin ? coin.dp : 2)}</strong></div>
                <label className="tp-lbl">Amount (USD)</label>
                <div className="tp-in"><span>$</span><input value={orderUsd} onChange={e => setOrderUsd(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></div>
                <div className="tp-q">{[100, 500, 1000, 5000].map(q => <button key={q} onClick={() => setOrderUsd(String(q))}>${q}</button>)}<button onClick={() => setOrderUsd(String(Math.floor(account.balance)))}>Max</button></div>
                <div className="tp-est">≈ {orderUsd && livePrice ? fmtNum(parseFloat(orderUsd || 0) / livePrice, 6) : "0"} {coin ? coin.base : ""}<span className="fee">fee {(FEE * 100).toFixed(1)}%</span></div>
                <div className="tp-btns"><button className="buy" onClick={() => order("long")}>Buy / Long</button><button className="sell" onClick={() => order("short")}>Sell / Short</button></div>
                {parseFloat(orderUsd || 0) * (1 + FEE) > account.balance && <div className="tp-warn">Not enough paper balance.</div>}
              </div>
            </section>
            <section className="panel">
              <div className="ph">Order book <span className="muted">illustrative</span></div>
              <OrderBook price={livePrice || 1} dp={coin ? coin.dp : 2} />
            </section>
          </aside>
        </div>

        {/* tabs */}
        <div className="tabsec">
          <div className="tabs">
            <button className={tab === "positions" ? "on" : ""} onClick={() => setTab("positions")}>Positions <span className="cnt">{account.positions.length}</span></button>
            <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History <span className="cnt">{account.history.length}</span></button>
            <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>Stats</button>
          </div>
          {tab === "positions" && <div className="tbody">{account.positions.length === 0 ? <div className="empty">No open positions. Place a practice order to begin.</div> : <table className="tbl"><thead><tr><th>Market</th><th>Side</th><th>Qty</th><th>Entry</th><th>Price</th><th>P&amp;L</th><th></th></tr></thead><tbody>{account.positions.map(p => { const c = coins.find(x => x.sym === p.sym) || { base: p.sym, dp: 2 }; const cur = priceMap[p.sym] || p.entry; const pnl = p.side === "long" ? (cur - p.entry) * p.qty : (p.entry - cur) * p.qty; const pct = (pnl / (p.entry * p.qty)) * 100; return <tr key={p.id}><td className="mkt">{c.base}<span>/USDT</span></td><td><span className={"side " + p.side}>{p.side}</span></td><td className="mono">{fmtNum(p.qty, 6)}</td><td className="mono">{fmtNum(p.entry, c.dp)}</td><td className="mono">{fmtNum(cur, c.dp)}</td><td className={"mono " + (pnl >= 0 ? "pos" : "neg")}>{fmtSig(pnl)} <span className="pct">({fmtSig(pct, 1)}%)</span></td><td><button className="closebtn" onClick={() => closePos(p.id)}>Close</button></td></tr>; })}</tbody></table>}</div>}
          {tab === "history" && <div className="tbody">{account.history.length === 0 ? <div className="empty">No closed trades yet.</div> : <table className="tbl"><thead><tr><th>Market</th><th>Side</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Closed</th></tr></thead><tbody>{account.history.map((h, i) => { const c = coins.find(x => x.sym === h.sym) || { base: h.sym, dp: 2 }; return <tr key={i}><td className="mkt">{c.base}<span>/USDT</span></td><td><span className={"side " + h.side}>{h.side}</span></td><td className="mono">{fmtNum(h.entry, c.dp)}</td><td className="mono">{fmtNum(h.exit, c.dp)}</td><td className={"mono " + (h.pnl >= 0 ? "pos" : "neg")}>{fmtSig(h.pnl)}</td><td className="muted small">{new Date(h.closed).toLocaleString()}</td></tr>; })}</tbody></table>}</div>}
          {tab === "stats" && <div className="tbody statsb"><div className="stat"><div className="sl">Closed trades</div><div className="sv">{account.history.length}</div></div><div className="stat"><div className="sl">Win rate</div><div className="sv">{winRate.toFixed(0)}%</div></div><div className="stat"><div className="sl">Realized P&amp;L</div><div className="sv" style={{ color: realized >= 0 ? "#2ebd85" : "#f0616d" }}>{fmtSig(realized)}</div></div><div className="stat"><div className="sl">Equity</div><div className="sv">{fmtUsd(equity)}</div></div><div className="stat wide"><div className="sl">Reading these numbers honestly</div><div className="snote">A handful of practice trades tells you almost nothing about whether an approach works — small samples are mostly luck. Use this to learn mechanics, not as proof of a winning strategy.</div></div></div>}
        </div>
    </div>
  );
}

/* ===================== platform: data, views, shell ===================== */
const FAPI = "https://fapi.binance.com/fapi/v1";
const CG = "https://api.coingecko.com/api/v3";
const FNG_URL = "https://api.alternative.me/fng/?limit=30";
const fmtBig = (n) => n >= 1e12 ? "$" + (n / 1e12).toFixed(2) + "T" : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + fmtNum(n, 0);

function technicalStance(candles) {
  if (!candles || candles.length < 30) return null;
  const c = candles.map(x => x.c), h = candles.map(x => x.h), l = candles.map(x => x.l);
  const price = c[c.length - 1], sig = [], last = a => a[a.length - 1];
  const r = last(rsi(c)); if (r != null) sig.push({ n: "RSI (14)", s: r > 70 ? "bear" : r < 30 ? "bull" : "neutral", d: r.toFixed(0) });
  const m = macd(c); const hh = last(m.hist); if (hh != null) sig.push({ n: "MACD", s: hh > 0 ? "bull" : hh < 0 ? "bear" : "neutral", d: hh > 0 ? "+hist" : "−hist" });
  [["SMA 20", sma(c, 20)], ["SMA 50", sma(c, 50)], ["SMA 200", sma(c, 200)]].forEach(([n, a]) => { const v = last(a); if (v != null) sig.push({ n, s: price > v ? "bull" : "bear", d: price > v ? "above" : "below" }); });
  const e9 = last(ema(c, 9)), e21 = last(ema(c, 21)); if (e9 != null && e21 != null) sig.push({ n: "EMA 9/21", s: e9 > e21 ? "bull" : "bear", d: e9 > e21 ? "9>21" : "9<21" });
  const st = stoch(h, l, c); const k = last(st.k); if (k != null) sig.push({ n: "Stochastic", s: k > 80 ? "bear" : k < 20 ? "bull" : "neutral", d: k.toFixed(0) });
  const w = last(willr(h, l, c)); if (w != null) sig.push({ n: "Williams %R", s: w > -20 ? "bear" : w < -80 ? "bull" : "neutral", d: w.toFixed(0) });
  const cc2 = last(cci(h, l, c)); if (cc2 != null) sig.push({ n: "CCI (20)", s: cc2 > 100 ? "bear" : cc2 < -100 ? "bull" : "neutral", d: cc2.toFixed(0) });
  const mo = last(momentum(c)); if (mo != null) sig.push({ n: "Momentum", s: mo > 0 ? "bull" : mo < 0 ? "bear" : "neutral", d: mo > 0 ? "positive" : "negative" });
  const b = boll(c); const bu = last(b.up), bl = last(b.lo); if (bu != null) sig.push({ n: "Bollinger", s: price > bu ? "bear" : price < bl ? "bull" : "neutral", d: price > bu ? "above upper" : price < bl ? "below lower" : "inside" });
  const bull = sig.filter(s => s.s === "bull").length, bear = sig.filter(s => s.s === "bear").length, neu = sig.filter(s => s.s === "neutral").length, net = bull - bear;
  const label = net >= 4 ? "Strong bullish configuration" : net >= 2 ? "Bullish lean" : net <= -4 ? "Strong bearish configuration" : net <= -2 ? "Bearish lean" : "Mixed / neutral";
  return { bull, bear, neu, total: sig.length, net, label, sig };
}

function usePlatform() {
  const [coins, setCoins] = useState(FALLBACK.map(c => ({ ...c, dp: dpFor(c.price), change: 0, high: 0, low: 0 })));
  const [priceMap, setPriceMap] = useState(() => { const m = {}; FALLBACK.forEach(c => m[c.sym] = c.price); return m; });
  const [mode, setMode] = useState("connecting");
  const [glob, setGlob] = useState(null);
  const [fng, setFng] = useState(null);
  const [funding, setFunding] = useState([]);
  const [ext, setExt] = useState({ glob: "load", fng: "load", fund: "load" });
  const liveRef = useRef(false);
  useEffect(() => {
    let on = true;
    const wt = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("t")), ms))]);
    (async () => {
      try {
        const [info, tick] = await wt(Promise.all([fetch(API + "/exchangeInfo").then(r => r.json()), fetch(API + "/ticker/24hr").then(r => r.json())]), 8000);
        if (!on) return;
        const tm = {}; tick.forEach(t => tm[t.symbol] = t);
        const list = info.symbols.filter(s => s.quoteAsset === "USDT" && s.status === "TRADING" && !/(UP|DOWN|BULL|BEAR)USDT$/.test(s.symbol))
          .map(s => { const t = tm[s.symbol] || {}; const price = +t.lastPrice || 0; return { sym: s.symbol, base: s.baseAsset, price, change: +t.priceChangePercent || 0, vol: +t.quoteVolume || 0, high: +t.highPrice || 0, low: +t.lowPrice || 0, dp: dpFor(price || 1) }; })
          .filter(c => c.price > 0).sort((a, b) => b.vol - a.vol);
        if (list.length > 20) { const pm = {}; list.forEach(c => pm[c.sym] = c.price); setCoins(list); setPriceMap(pm); liveRef.current = true; setMode("live"); } else throw new Error("e");
      } catch (e) { liveRef.current = false; setMode("sim"); }
      try { const g = await wt(fetch(CG + "/global").then(r => r.json()), 8000); if (on && g && g.data) { setGlob({ mcap: g.data.total_market_cap.usd, vol: g.data.total_volume.usd, btcDom: g.data.market_cap_percentage.btc, ethDom: g.data.market_cap_percentage.eth, active: g.data.active_cryptocurrencies, mcapChg: g.data.market_cap_change_percentage_24h_usd }); setExt(s => ({ ...s, glob: "ok" })); } else if (on) setExt(s => ({ ...s, glob: "fail" })); } catch (e) { if (on) setExt(s => ({ ...s, glob: "fail" })); }
      try { const f = await wt(fetch(FNG_URL).then(r => r.json()), 8000); if (on && f && f.data) { setFng({ value: +f.data[0].value, label: f.data[0].value_classification, history: f.data.map(d => +d.value).reverse() }); setExt(s => ({ ...s, fng: "ok" })); } else if (on) setExt(s => ({ ...s, fng: "fail" })); } catch (e) { if (on) setExt(s => ({ ...s, fng: "fail" })); }
      try { const fr = await wt(fetch(FAPI + "/premiumIndex").then(r => r.json()), 8000); if (on && Array.isArray(fr) && fr.length) { setFunding(fr.map(x => ({ sym: x.symbol, rate: +x.lastFundingRate, mark: +x.markPrice }))); setExt(s => ({ ...s, fund: "ok" })); } else if (on) setExt(s => ({ ...s, fund: "fail" })); } catch (e) { if (on) setExt(s => ({ ...s, fund: "fail" })); }
    })();
    return () => { on = false; };
  }, []);
  useEffect(() => {
    const id = setInterval(async () => {
      if (!liveRef.current) { setPriceMap(prev => { const m = { ...prev }; coins.forEach(c => { if (m[c.sym]) m[c.sym] = Math.max(m[c.sym] * (1 + (Math.random() - 0.5) * 0.006), 1e-9); }); return m; }); return; }
      try { const all = await fetch(API + "/ticker/price").then(r => r.json()); const pm = {}; all.forEach(x => pm[x.symbol] = +x.price); setPriceMap(prev => ({ ...prev, ...pm })); } catch (e) {}
    }, liveRef.current ? 4000 : 1500);
    return () => clearInterval(id);
  }, [mode, coins.length]);
  return { coins, priceMap, mode, glob, fng, funding, ext };
}

function lightStance(c, h, l) {
  const last = a => a[a.length - 1]; let bull = 0, bear = 0;
  const r = last(rsi(c)); if (r != null) { if (r > 70) bear++; else if (r < 30) bull++; }
  const m = macd(c); const hh = last(m.hist); if (hh != null) { if (hh > 0) bull++; else if (hh < 0) bear++; }
  const price = c[c.length - 1];
  const s50 = last(sma(c, 50)); if (s50 != null) { price > s50 ? bull++ : bear++; }
  const e9 = last(ema(c, 9)), e21 = last(ema(c, 21)); if (e9 != null && e21 != null) { e9 > e21 ? bull++ : bear++; }
  const st = stoch(h, l, c); const k = last(st.k); if (k != null) { if (k > 80) bear++; else if (k < 20) bull++; }
  const mo = last(momentum(c)); if (mo != null) { mo > 0 ? bull++ : bear++; }
  const net = bull - bear;
  const label = net >= 3 ? "Strong bull" : net >= 1 ? "Bullish" : net <= -3 ? "Strong bear" : net <= -1 ? "Bearish" : "Neutral";
  return { rsi: r, macd: hh, trend: s50 != null ? (price > s50 ? "up" : "down") : null, net, label };
}
function useTechBoard(symbols, tf, active) {
  const [data, setData] = useState({}); const [loading, setLoading] = useState(false);
  const key = symbols.join(",");
  useEffect(() => {
    if (!active || !symbols.length) return; let on = true; setLoading(true); setData({});
    const wt = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("t")), ms))]);
    (async () => { const out = {}; await Promise.all(symbols.map(async s => { try { const raw = await wt(fetch(`${API}/klines?symbol=${s}&interval=${tf}&limit=160`).then(r => r.json()), 9000); if (Array.isArray(raw) && raw.length) { const c = raw.map(k => +k[4]), h = raw.map(k => +k[2]), l = raw.map(k => +k[3]); out[s] = lightStance(c, h, l); } } catch (e) {} })); if (on) { setData(out); setLoading(false); } })();
    return () => { on = false; };
  }, [key, tf, active]);
  return { data, loading };
}

function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" style={{ flexShrink: 0, display: "block" }} aria-label="NF CryptoMarket logo">
      <defs>
        <linearGradient id="nfGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3cd7a" /><stop offset="0.55" stopColor="#e8b14c" /><stop offset="1" stopColor="#cf8f37" /></linearGradient>
      </defs>
      <rect x="2" y="2" width="40" height="40" rx="12" fill="url(#nfGold)" />
      <rect x="2.5" y="2.5" width="39" height="39" rx="11.5" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1" />
      <text x="22" y="22.5" textAnchor="middle" dominantBaseline="central" fontFamily="'Space Grotesk', system-ui, sans-serif" fontWeight="700" fontSize="19" letterSpacing="-1.2" fill="#15110a">NF</text>
    </svg>
  );
}
function StatCard({ label, value, chg, sub }) {
  return (<div className="scard"><div className="sc-l">{label}</div><div className="sc-v">{value}</div>{chg != null ? <div className={"sc-c " + (chg >= 0 ? "pos" : "neg")}>{fmtSig(chg, 2)}%</div> : sub ? <div className="sc-s">{sub}</div> : null}</div>);
}
function PaidCard({ title, what, provider }) {
  return (<div className="paidcard"><div className="pc-h"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6678" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>{title}</div><div className="pc-w">{what}</div><div className="pc-n">No free, reliable source for this. We don't show fabricated numbers — a live version needs a licensed feed{provider ? ` (e.g. ${provider})` : ""}.</div></div>);
}
function FngGauge({ fng, status }) {
  if (!fng) return <div className="loadingbox">{status === "fail" ? "Fear & Greed couldn't be reached on this connection." : "Loading Fear & Greed…"}</div>;
  const v = fng.value, col = v < 25 ? "#f0616d" : v < 45 ? "#f5a35c" : v < 55 ? "#e8b14c" : v < 75 ? "#5ad19e" : "#2ebd85";
  return (<div className="fng"><div className="fng-num" style={{ color: col }}>{v}<span>/100</span></div><div className="fng-lbl" style={{ color: col }}>{fng.label}</div><div className="fng-bar"><div className="fng-needle" style={{ left: v + "%" }} /></div><div className="fng-scale"><span>Extreme fear</span><span>Neutral</span><span>Extreme greed</span></div></div>);
}
function DomBars({ glob }) {
  const others = Math.max(0, 100 - glob.btcDom - glob.ethDom);
  const row = (lbl, val, color) => <div className="domrow"><span className="dl">{lbl}</span><div className="domtrack"><div className="domfill" style={{ width: val + "%", background: color }} /></div><span className="mono dv">{val.toFixed(1)}%</span></div>;
  return <div className="dombars">{row("BTC", glob.btcDom, "#e8b14c")}{row("ETH", glob.ethDom, "#627eea")}{row("Others", others, "#4fb7d8")}</div>;
}

function MarketsView({ coins, priceMap, glob, fng, mode, onPick }) {
  const [sub, setSub] = useState("top");
  const ranked = useMemo(() => { const L = coins.map(c => ({ ...c, price: priceMap[c.sym] || c.price })); if (sub === "gainers") return [...L].sort((a, b) => b.change - a.change).slice(0, 60); if (sub === "losers") return [...L].sort((a, b) => a.change - b.change).slice(0, 60); if (sub === "volume") return [...L].sort((a, b) => b.vol - a.vol).slice(0, 60); return L.slice(0, 100); }, [coins, priceMap, sub]);
  return (
    <div className="page">
      <div className="page-h"><h1>Market Overview</h1><p>Live spot data across {coins.length} Binance USDT markets. Click any market to open it in the paper terminal.</p></div>
      <div className="statrow">
        <StatCard label="Total market cap" value={glob ? fmtBig(glob.mcap) : "—"} chg={glob ? glob.mcapChg : null} />
        <StatCard label="24h volume" value={glob ? fmtBig(glob.vol) : "—"} />
        <StatCard label="BTC dominance" value={glob ? glob.btcDom.toFixed(1) + "%" : "—"} />
        <StatCard label="Active cryptos" value={glob ? glob.active.toLocaleString() : "—"} />
        <StatCard label="Fear & Greed" value={fng ? String(fng.value) : "—"} sub={fng ? fng.label : ""} />
      </div>
      <div className="panel">
        <div className="subtabs">{[["top", "Top"], ["gainers", "Gainers"], ["losers", "Losers"], ["volume", "Volume"]].map(([id, l]) => <button key={id} className={sub === id ? "on" : ""} onClick={() => setSub(id)}>{l}</button>)}</div>
        <div className="tablewrap"><table className="dtbl"><thead><tr><th>#</th><th>Market</th><th>Price</th><th>24h %</th><th>24h Volume</th><th className="hide-md">24h High</th><th className="hide-md">24h Low</th></tr></thead><tbody>
          {ranked.map((c, i) => <tr key={c.sym} onClick={() => onPick(c.sym)}><td className="rk">{i + 1}</td><td className="mkt2"><span className="mb">{c.base}</span><span className="mq">/USDT</span></td><td className="mono">{fmtNum(c.price, c.dp)}</td><td className={"mono " + (c.change >= 0 ? "pos" : "neg")}>{fmtSig(c.change, 2)}%</td><td className="mono dim">${volReadable(c.vol)}</td><td className="mono dim hide-md">{c.high ? fmtNum(c.high, c.dp) : "—"}</td><td className="mono dim hide-md">{c.low ? fmtNum(c.low, c.dp) : "—"}</td></tr>)}
        </tbody></table></div>
      </div>
      {mode !== "live" && <div className="simnote"><strong>Showing simulated sample data.</strong> Live feeds (Binance, CoinGecko, alternative.me) are blocked inside this in-app preview, so prices here are a placeholder and not real. Download this file and open it locally, or deploy it (e.g. to Netlify), and the live market data loads automatically — those APIs allow cross-origin requests from a real site.</div>}
    </div>
  );
}

function DerivativesView({ coins, funding, ext, onPick }) {
  const rows = useMemo(() => { const fm = {}; funding.forEach(f => fm[f.sym] = f); return coins.slice(0, 45).map(c => ({ ...c, f: fm[c.sym] })).filter(c => c.f).slice(0, 30); }, [coins, funding]);
  return (
    <div className="page">
      <div className="page-h"><h1>Derivatives</h1><p>Perpetual-futures funding from Binance. Positive funding means longs pay shorts (crowded longs); negative means shorts pay longs.</p></div>
      <div className="panel">
        <div className="ph2">Funding rates <span className="pill2">{rows.length ? rows.length + " perps · live" : (ext.fund === "fail" ? "unavailable" : "loading")}</span></div>
        {rows.length === 0 ? (ext.fund === "fail" ? <div className="loadingbox">Funding data couldn't be reached on this connection — it loads when the app runs as a live site (see the note at the bottom of Markets).</div> : <div className="loadingbox">Loading funding rates…</div>) :
          <div className="tablewrap"><table className="dtbl"><thead><tr><th>Market</th><th>Mark price</th><th>Funding (8h)</th><th className="hide-md">Annualized</th></tr></thead><tbody>
            {rows.map(c => { const r = c.f.rate; return <tr key={c.sym} onClick={() => onPick(c.sym)}><td className="mkt2"><span className="mb">{c.base}</span><span className="mq">/USDT</span></td><td className="mono">{fmtNum(c.f.mark, dpFor(c.f.mark))}</td><td className={"mono " + (r >= 0 ? "pos" : "neg")}>{fmtSig(r * 100, 4)}%</td><td className={"mono hide-md " + (r >= 0 ? "pos" : "neg")}>{fmtSig(r * 3 * 365 * 100, 1)}%</td></tr>; })}
          </tbody></table></div>}
      </div>
      <div className="indgrid"><PaidCard title="Liquidations" what="Aggregate long/short liquidation volume across exchanges, by coin and timeframe." provider="CoinGlass" /><PaidCard title="Open interest (aggregated)" what="Total OI across all exchanges. Binance exposes per-symbol OI but not a clean cross-exchange aggregate." provider="CoinGlass / Coinalyze" /></div>
    </div>
  );
}

function IndicatorsView({ glob, fng, ext }) {
  return (
    <div className="page">
      <div className="page-h"><h1>Market Indicators</h1><p>Sentiment and structure gauges. These describe current conditions — they do not predict price.</p></div>
      <div className="indgrid2">
        <div className="panel pad"><div className="ph2">Fear &amp; Greed Index</div><FngGauge fng={fng} status={ext.fng} /><div className="cap">Source: alternative.me · updates daily</div></div>
        <div className="panel pad"><div className="ph2">Bitcoin Dominance</div>{glob ? <DomBars glob={glob} /> : <div className="loadingbox">{ext.glob === "fail" ? "Couldn't reach CoinGecko on this connection." : "Loading dominance…"}</div>}<div className="cap">Share of total crypto market cap · source: CoinGecko</div></div>
      </div>
      <div className="indgrid">
        <PaidCard title="Altcoin Season Index" what="Whether the market favours Bitcoin or altcoins, from 90-day relative performance of the top 50 coins." provider="Blockchaincenter" />
        <PaidCard title="Market Cycle Indicators" what="On-chain cycle gauges — MVRV Z-score, Pi-Cycle Top, NUPL, Puell Multiple." provider="Glassnode / CryptoQuant" />
        <PaidCard title="CoinMarketCap 20 / 100" what="Proprietary market-cap-weighted indices of the largest assets." provider="CoinMarketCap" />
      </div>
    </div>
  );
}

function ETFView() {
  return (<div className="page"><div className="page-h"><h1>ETF Flows</h1><p>Spot crypto ETF creation and redemption flows. This is licensed data — we show honest placeholders rather than invented figures.</p></div><div className="indgrid"><PaidCard title="Bitcoin ETF Flows" what="Daily net inflow/outflow for US spot Bitcoin ETFs (IBIT, FBTC, GBTC, ARKB…)." provider="Farside Investors" /><PaidCard title="Ethereum ETF Flows" what="Daily net flows for US spot Ethereum ETFs." provider="Farside Investors" /><PaidCard title="Crypto ETFs Overview" what="AUM, holdings and fees across listed crypto ETFs and ETPs." provider="issuer disclosures" /></div><div className="indgrid"><PaidCard title="Bitcoin Treasuries" what="Public companies and funds holding BTC on their balance sheets." provider="bitcointreasuries.net" /><PaidCard title="Exchange Inflows / Outflows" what="On-chain coin movement into and out of exchange wallets." provider="CryptoQuant / Glassnode" /></div></div>);
}

function Stance({ stance }) {
  return (<div className="stance"><div className="stance-top"><div className={"stance-label " + (stance.net >= 2 ? "bull" : stance.net <= -2 ? "bear" : "neu")}>{stance.label}</div><div className="stance-counts"><span className="pos">{stance.bull} bullish</span> · <span className="neg">{stance.bear} bearish</span> · <span className="dim">{stance.neu} neutral</span></div></div><div className="stancebar"><div className="sb b" style={{ flexGrow: stance.bull || 0.001 }} /><div className="sb n" style={{ flexGrow: stance.neu || 0.001 }} /><div className="sb r" style={{ flexGrow: stance.bear || 0.001 }} /></div><div className="siglist">{stance.sig.map((s, i) => <div key={i} className="sigrow"><span className="sn">{s.n}</span><span className={"ss " + s.s}>{s.s === "bull" ? "Bullish" : s.s === "bear" ? "Bearish" : "Neutral"} <em>{s.d}</em></span></div>)}</div></div>);
}

function TechnicalsView({ coins, onPick }) {
  const [tf, setTf] = useState("1h");
  const [stanceSym, setStanceSym] = useState("BTCUSDT");
  const [sort, setSort] = useState("rank");
  const N = 48;
  const top = useMemo(() => coins.slice(0, N).map(c => c.sym), [coins]);
  const { data: board, loading } = useTechBoard(top, tf, true);
  const [stance, setStance] = useState(null);
  const [stanceErr, setStanceErr] = useState(false);
  useEffect(() => { let on = true; setStance(null); setStanceErr(false); const wt = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("t")), ms))]); (async () => { try { const raw = await wt(fetch(`${API}/klines?symbol=${stanceSym}&interval=${tf}&limit=240`).then(r => r.json()), 9000); if (on && Array.isArray(raw)) setStance(technicalStance(raw.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })))); else if (on) setStanceErr(true); } catch (e) { if (on) setStanceErr(true); } })(); return () => { on = false; }; }, [stanceSym, tf]);
  const stBase = (coins.find(c => c.sym === stanceSym) || {}).base || "";
  const heatEmpty = !loading && Object.keys(board).length === 0;
  const rows = useMemo(() => {
    let r = coins.slice(0, N).map((c, i) => ({ ...c, rank: i + 1, b: board[c.sym] }));
    if (sort === "rsiAsc") r = [...r].sort((a, b) => ((a.b && a.b.rsi != null ? a.b.rsi : 999) - (b.b && b.b.rsi != null ? b.b.rsi : 999)));
    else if (sort === "rsiDesc") r = [...r].sort((a, b) => ((b.b && b.b.rsi != null ? b.b.rsi : -1) - (a.b && a.b.rsi != null ? a.b.rsi : -1)));
    else if (sort === "bull") r = [...r].sort((a, b) => ((b.b ? b.b.net : -99) - (a.b ? a.b.net : -99)));
    else if (sort === "bear") r = [...r].sort((a, b) => ((a.b ? a.b.net : 99) - (b.b ? b.b.net : 99)));
    return r;
  }, [coins, board, sort]);
  const leanClass = (net) => net >= 3 ? "lean-sb" : net >= 1 ? "lean-b" : net <= -3 ? "lean-ss" : net <= -1 ? "lean-s" : "lean-n";
  return (
    <div className="page">
      <div className="page-h"><h1>Technical Analysis</h1><p>Indicator readings computed live from Binance candles across {N} markets — mechanical snapshots of current conditions, <em>not forecasts.</em> Click any coin to inspect its full breakdown.</p></div>
      <div className="tfbar">{["15m", "1h", "4h", "1d"].map(t => <button key={t} className={tf === t ? "on" : ""} onClick={() => setTf(t)}>{t}</button>)}</div>

      <div className="panel pad">
        <div className="ph2">RSI Heatmap <span className="pill2">{tf} · live · {N} markets</span></div>
        <div className="heatleg"><span><i style={{ background: "#2ebd85" }} />Oversold &lt;30</span><span><i style={{ background: "#3a4250" }} />Neutral</span><span><i style={{ background: "#f0616d" }} />Overbought &gt;70</span><span className="heathint">tap a tile to inspect ↓</span></div>
        {loading ? <div className="loadingbox">Computing indicators across {N} markets…</div> :
          heatEmpty ? <div className="loadingbox">Couldn't reach Binance candle data on this connection — fills in when run as a live site.</div> :
          <div className="heatgrid">{coins.slice(0, N).map(c => { const b = board[c.sym]; const r = b ? b.rsi : null; const col = r == null ? "#222934" : r > 70 ? "#f0616d" : r > 60 ? "#cf7158" : r < 30 ? "#2ebd85" : r < 40 ? "#3f8f6f" : "#3a4250"; return <button key={c.sym} className={"heatcell" + (stanceSym === c.sym ? " sel" : "")} style={{ background: col }} onClick={() => setStanceSym(c.sym)}><span className="hc-b">{c.base}</span><span className="hc-r">{r == null ? "—" : r.toFixed(0)}</span></button>; })}</div>}
      </div>

      <div className="panel pad">
        <div className="ph2">Signals Board <span className="pill2">{tf} · live · click a row to inspect</span></div>
        <div className="subtabs sortbar">{[["rank", "Rank"], ["rsiDesc", "RSI high→low"], ["rsiAsc", "RSI low→high"], ["bull", "Most bullish"], ["bear", "Most bearish"]].map(([id, l]) => <button key={id} className={sort === id ? "on" : ""} onClick={() => setSort(id)}>{l}</button>)}</div>
        <div className="tablewrap"><table className="dtbl"><thead><tr><th>#</th><th>Market</th><th>Price</th><th>RSI</th><th className="hide-md">MACD</th><th className="hide-md">Trend</th><th>Lean</th><th></th></tr></thead><tbody>
          {rows.map(c => { const b = c.b; return <tr key={c.sym} className={stanceSym === c.sym ? "rowsel" : ""} onClick={() => setStanceSym(c.sym)}><td className="rk">{c.rank}</td><td className="mkt2"><span className="mb">{c.base}</span><span className="mq">/USDT</span></td><td className="mono">{fmtNum(c.price, c.dp)}</td><td className={"mono " + (b && b.rsi != null ? (b.rsi > 70 ? "neg" : b.rsi < 30 ? "pos" : "") : "")}>{b && b.rsi != null ? b.rsi.toFixed(0) : "—"}</td><td className={"mono hide-md " + (b && b.macd != null ? (b.macd > 0 ? "pos" : "neg") : "dim")}>{b && b.macd != null ? (b.macd > 0 ? "bullish" : "bearish") : "—"}</td><td className={"mono hide-md " + (b && b.trend ? (b.trend === "up" ? "pos" : "neg") : "dim")}>{b && b.trend ? (b.trend === "up" ? "above 50" : "below 50") : "—"}</td><td>{b ? <span className={"leanpill " + leanClass(b.net)}>{b.label}</span> : <span className="dim">—</span>}</td><td><button className="rowopen" onClick={(e) => { e.stopPropagation(); onPick(c.sym); }}>open →</button></td></tr>; })}
        </tbody></table></div>
      </div>

      <div className="panel pad">
        <div className="ph2">Technical Stance — <select value={stanceSym} onChange={e => setStanceSym(e.target.value)} className="coinsel">{coins.slice(0, 120).map(c => <option key={c.sym} value={c.sym}>{c.base}/USDT</option>)}</select><button className="inspect-open" onClick={() => onPick(stanceSym)}>Open in terminal →</button></div>
        {stanceErr ? <div className="loadingbox">Couldn't load candle data on this connection — this fills in when run as a live site.</div> : !stance ? <div className="loadingbox">Reading {stBase} indicators…</div> : <Stance stance={stance} />}
        <div className="stancewarn">This tallies where {stBase}'s indicators sit <strong>right now</strong> using standard conventions (e.g. an overbought oscillator counts as a bearish lean). It's a description of present state, <strong>not a prediction</strong> — and these readings have no proven ability to forecast returns. Our own strategy testing keeps confirming exactly that.</div>
      </div>
    </div>
  );
}

function AskAI() {
  const [q, setQ] = useState(""); const [msgs, setMsgs] = useState([]); const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [msgs, busy]);
  const ask = async () => {
    const question = q.trim(); if (!question || busy) return;
    const next = [...msgs, { role: "user", text: question }]; setMsgs(next); setQ(""); setBusy(true);
    try {
      const res = await fetch("/.netlify/functions/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.map(m => ({ role: m.role, text: m.text })) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setMsgs(m => [...m, { role: "assistant", text: data.error ? "NF AI: " + data.error : "The AI service isn't available yet. If this is the live site, make sure the GEMINI_API_KEY is set in Netlify." }]); }
      else { setMsgs(m => [...m, { role: "assistant", text: (data.text || "I couldn't answer that one — try rephrasing?").trim() }]); }
    } catch (e) { setMsgs(m => [...m, { role: "assistant", text: "I couldn't reach the AI service. (The assistant only works on the deployed site with the backend configured — not in this preview.)" }]); }
    setBusy(false);
  };
  return (
    <div className="panel askai">
      <div className="ph2">Ask NF AI <span className="pill2">explains · never predicts</span></div>
      <div className="ai-box" ref={boxRef}>
        {msgs.length === 0 && <div className="ai-empty">Ask about any concept — “what is funding rate?”, “how does RSI work?”, “what's the difference between spot and perps?”. NF AI explains things; it won't tell you what to buy or where price is going.</div>}
        {msgs.map((m, i) => <div key={i} className={"ai-msg " + m.role}><div className="ai-who">{m.role === "user" ? "You" : "NF AI"}</div><div className="ai-text">{m.text}</div></div>)}
        {busy && <div className="ai-msg assistant"><div className="ai-who">NF AI</div><div className="ai-text dim">thinking…</div></div>}
      </div>
      <div className="ai-input"><input value={q} placeholder="Ask a crypto question…" onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ask(); }} /><button onClick={ask} disabled={busy}>Ask</button></div>
    </div>
  );
}

function ScanView({ coins, priceMap, funding, onPick }) {
  const [m2, setM2] = useState("gainers");
  const list = useMemo(() => { const L = coins.map(c => ({ ...c, price: priceMap[c.sym] || c.price })); if (m2 === "gainers") return [...L].sort((a, b) => b.change - a.change).slice(0, 30); if (m2 === "losers") return [...L].sort((a, b) => a.change - b.change).slice(0, 30); if (m2 === "volume") return [...L].sort((a, b) => b.vol - a.vol).slice(0, 30); if (m2 === "funding") { const fm = {}; funding.forEach(f => fm[f.sym] = f.rate); return L.filter(c => fm[c.sym] != null).map(c => ({ ...c, fr: fm[c.sym] })).sort((a, b) => Math.abs(b.fr) - Math.abs(a.fr)).slice(0, 30); } return L.slice(0, 30); }, [coins, priceMap, funding, m2]);
  return (
    <div className="page">
      <div className="page-h"><h1>NF-Scan</h1><p>A rule-based scanner over live data. It surfaces coins matching a condition — these are <em>observations, not buy or sell calls.</em> A flagged coin is never a recommendation.</p></div>
      <AskAI />
      <div className="panel">
        <div className="subtabs">{[["gainers", "Top Gainers"], ["losers", "Top Losers"], ["volume", "Highest Volume"], ["funding", "Extreme Funding"]].map(([id, l]) => <button key={id} className={m2 === id ? "on" : ""} onClick={() => setM2(id)}>{l}</button>)}</div>
        <div className="tablewrap"><table className="dtbl"><thead><tr><th>Market</th><th>Price</th><th>24h %</th><th>{m2 === "funding" ? "Funding 8h" : "Volume"}</th></tr></thead><tbody>
          {list.map(c => <tr key={c.sym} onClick={() => onPick(c.sym)}><td className="mkt2"><span className="mb">{c.base}</span><span className="mq">/USDT</span></td><td className="mono">{fmtNum(c.price, c.dp)}</td><td className={"mono " + (c.change >= 0 ? "pos" : "neg")}>{fmtSig(c.change, 2)}%</td><td className={"mono " + (m2 === "funding" ? (c.fr >= 0 ? "pos" : "neg") : "dim")}>{m2 === "funding" ? fmtSig(c.fr * 100, 4) + "%" : "$" + volReadable(c.vol)}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
}

const GLOSSARY = [
  { t: "Paper trading", d: "Practising with simulated money instead of real funds. Lets you learn mechanics and test ideas with zero financial risk — exactly what this whole platform is for." },
  { t: "Spot market", d: "Buying or selling the actual asset for immediate delivery at the current price. You own the coin. Contrast with derivatives, where you trade a contract." },
  { t: "Perpetual futures", d: "A derivative contract that tracks a coin's price with no expiry. Kept in line with spot by the funding mechanism. Often traded with leverage." },
  { t: "Funding rate", d: "Small periodic payments (usually every 8h) between longs and shorts on perps. Positive funding = longs pay shorts, a sign the crowd is leaning long." },
  { t: "Leverage", d: "Borrowing to size a position larger than your capital. It multiplies both gains and losses, and can liquidate you. Powerful and dangerous — the fastest way to lose an account." },
  { t: "Liquidation", d: "When a leveraged position's losses exhaust its margin and the exchange force-closes it. The more leverage, the closer the liquidation price." },
  { t: "RSI", d: "Relative Strength Index — an oscillator from 0–100 measuring recent up vs down momentum. Above 70 is often called overbought, below 30 oversold. A description, not a prediction." },
  { t: "MACD", d: "Moving Average Convergence Divergence — the gap between a fast and slow EMA, with a signal line. Used to read momentum shifts. Like all indicators, it describes the past." },
  { t: "VWAP", d: "Volume-Weighted Average Price — the average price weighted by volume over a period. A common reference for 'fair' intraday value." },
  { t: "Bitcoin dominance", d: "Bitcoin's share of the total crypto market cap. Rising dominance often means money favouring BTC over alts; falling can signal 'altcoin season'." },
  { t: "Fear & Greed Index", d: "A 0–100 sentiment gauge built from volatility, momentum, volume and more. Extreme fear and extreme greed are widely watched, but sentiment doesn't reliably time the market." },
  { t: "Why signals don't guarantee profit", d: "Mechanical buy/sell signals and indicator readings describe current conditions; they have no proven ability to predict future returns. Backtests overfit, and small samples are mostly luck. Treat every 'signal' as information, not instruction." },
];
function LearnView() {
  return (<div className="page"><div className="page-h"><h1>Learn</h1><p>Plain-language explanations of the concepts used across this platform.</p></div><div className="learngrid">{GLOSSARY.map((g, i) => <div key={i} className="learncard"><h3>{g.t}</h3><p>{g.d}</p></div>)}</div></div>);
}

function NewsView() {
  const [filter, setFilter] = useState("");
  const [posts, setPosts] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let on = true; setPosts(null); setErr(null);
    (async () => {
      try {
        const r = await fetch("/.netlify/functions/news" + (filter ? "?filter=" + filter : ""));
        const data = await r.json().catch(() => ({}));
        if (!on) return;
        if (!r.ok || data.error) { setErr(data.error || "News service unavailable."); setPosts([]); }
        else { setPosts(data.posts || []); }
      } catch (e) { if (on) { setErr("preview"); setPosts([]); } }
    })();
    return () => { on = false; };
  }, [filter]);
  const ago = (iso) => { if (!iso) return ""; const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; };
  return (
    <div className="page">
      <div className="page-h"><h1>Market News</h1><p>Latest crypto headlines aggregated by CryptoPanic. We link to the original sources and don't editorialise — read critically, and remember headlines aren't trading signals.</p></div>
      <div className="tfbar">{[["", "Latest"], ["hot", "Hot"], ["rising", "Rising"], ["bullish", "Bullish"], ["bearish", "Bearish"], ["important", "Important"]].map(([id, l]) => <button key={id || "latest"} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>{l}</button>)}</div>
      {posts === null ? <div className="loadingbox">Loading news…</div> :
        err === "preview" ? <div className="newsnote"><div className="nn-h">News loads on the live site</div><p>The news feed runs through a serverless function, so it only works on the deployed site with a CryptoPanic token configured — not in this in-app preview. Once deployed with <code>CRYPTOPANIC_TOKEN</code> set in Netlify, real headlines appear here.</p></div> :
        err ? <div className="newsnote"><div className="nn-h">News unavailable</div><p>{err}</p><p className="nn-foot">If this is the live site, check that <code>CRYPTOPANIC_TOKEN</code> is set correctly in Netlify's environment variables.</p></div> :
        posts.length === 0 ? <div className="loadingbox">No headlines right now — try another filter.</div> :
        <div className="newsgrid">{posts.map((p, i) => <a key={i} className="newscard" href={p.url || "#"} target="_blank" rel="noopener noreferrer">
          <div className="nc-top">{p.coins.map(c => <span key={c} className="nc-coin">{c}</span>)}<span className="nc-time">{ago(p.published_at)}</span></div>
          <div className="nc-title">{p.title}</div>
          <div className="nc-src">{p.source}{p.kind && p.kind !== "news" ? " · " + p.kind : ""}</div>
        </a>)}</div>}
      <div className="news-attrib">News aggregated by <a href="https://cryptopanic.com" target="_blank" rel="noopener noreferrer">CryptoPanic</a>. Headlines link to their original publishers.</div>
    </div>
  );
}

const MODALS = {
  about: { t: "About NF CryptoMarket", b: ["NF CryptoMarket is a practice and market-research platform. It pairs real, live market data with a fully simulated trading environment so you can study charts, test indicators, mark up levels, and rehearse trades without risking a cent.", "It grew out of a simple principle: be honest about what market tools can and can't tell you. Indicators describe the present; they don't predict the future. Strategies have to be proven on real samples, not assumed. Where we don't have reliable data, we say so rather than inventing numbers.", "No real money is ever involved — no deposits, no withdrawals, no live trading."] },
  disclaimer: { t: "Disclaimer", b: ["NF CryptoMarket is for education and practice only. Nothing on this platform is financial, investment, or trading advice, or a recommendation to buy or sell any asset.", "All trading here is simulated with virtual funds. Market data is supplied by third parties (Binance, CoinGecko, alternative.me) for study only and may be delayed, incomplete, or unavailable.", "Indicator readings, technical stances, scanner results, and chart projections describe current or past conditions and your own annotations — they do not predict price and have no guaranteed accuracy. Real crypto trading carries substantial risk of loss."] },
  terms: { t: "Terms of Use", b: ["By using NF CryptoMarket you agree it is a free educational tool provided 'as is', without warranties of any kind, including accuracy or availability of data.", "You may use it for personal, non-commercial learning. You are responsible for any decisions you make. The platform performs no real transactions and holds no funds.", "Third-party data remains the property of its providers and is subject to their terms."] },
  privacy: { t: "Privacy Policy", b: ["NF CryptoMarket keeps your practice account (balance, positions, history, and chart drawings) in your browser's local storage on your own device. It is not transmitted to us or stored on a server.", "The app fetches public market data directly from third-party APIs; those requests are subject to those providers' own policies. The AI assistant sends only the questions you type, in order to answer them.", "Clearing your browser data or pressing Reset removes your practice account."] },
};
function Modal({ kind, onClose }) {
  const m = MODALS[kind]; if (!m) return null;
  return (<div className="modal-bg" onClick={onClose}><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-h"><span>{m.t}</span><button onClick={onClose}>✕</button></div><div className="modal-b">{m.b.map((p, i) => <p key={i}>{p}</p>)}</div></div></div>);
}

export default function App() {
  const plat = usePlatform();
  const [view, setView] = useState("markets");
  const [focus, setFocus] = useState(null);
  const [modal, setModal] = useState(null);
  const openCoin = (sym) => { setFocus(sym); setView("terminal"); };
  const NAV = [["markets", "Markets"], ["derivatives", "Derivatives"], ["indicators", "Indicators"], ["etfs", "ETFs"], ["technicals", "Technicals"], ["scan", "NF-Scan"], ["news", "News"], ["terminal", "Terminal"], ["learn", "Learn"]];
  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="navbar">
        <div className="brand" onClick={() => setView("markets")} style={{ cursor: "pointer" }}>
          <Logo size={34} />
          <div className="bword"><div className="bname">NF CryptoMarket</div><div className="btag">Learn Market Everywhere</div></div>
        </div>
        <nav className="nav">{NAV.map(([id, label]) => <button key={id} className={"navl" + (view === id ? " on" : "")} onClick={() => setView(id)}>{label}</button>)}</nav>
        <div className="navright">
          <span className="pbadge">PRACTICE</span>
          <span className={"mode m-" + plat.mode}><i className="dot" />{plat.mode === "live" ? "LIVE" : plat.mode === "sim" ? "SIM" : "…"}</span>
        </div>
      </header>
      <main className="viewport">
        {view === "markets" && <MarketsView {...plat} onPick={openCoin} />}
        {view === "derivatives" && <DerivativesView {...plat} onPick={openCoin} />}
        {view === "indicators" && <IndicatorsView {...plat} />}
        {view === "etfs" && <ETFView />}
        {view === "technicals" && <TechnicalsView {...plat} onPick={openCoin} />}
        {view === "scan" && <ScanView {...plat} onPick={openCoin} />}
        {view === "news" && <NewsView />}
        {view === "terminal" && <Terminal focusSymbol={focus} />}
        {view === "learn" && <LearnView />}
      </main>
      <footer className="sitefoot">
        <div className="sf-cols">
          <div className="sf-col brandcol"><div className="sf-brand"><Logo size={26} />NF CryptoMarket</div><div className="sf-slogan">Learn Market Everywhere</div><p className="sf-blurb">A practice &amp; market-research platform. Real market data, simulated trading, and honesty about what it can and can't tell you.</p></div>
          <div className="sf-col"><h4>About</h4><button onClick={() => setModal("about")}>About Us</button><button onClick={() => setModal("disclaimer")}>Disclaimer</button><button onClick={() => setModal("terms")}>Terms of Use</button><button onClick={() => setModal("privacy")}>Privacy Policy</button></div>
          <div className="sf-col"><h4>Platform</h4><button onClick={() => setView("markets")}>Markets</button><button onClick={() => setView("technicals")}>Technicals</button><button onClick={() => setView("terminal")}>Paper Terminal</button><button onClick={() => setView("learn")}>Learn</button></div>
          <div className="sf-col"><h4>Data sources</h4><span className="sf-static">Spot &amp; funding — Binance</span><span className="sf-static">Global &amp; dominance — CoinGecko</span><span className="sf-static">Sentiment — alternative.me</span></div>
        </div>
        <div className="sf-legal">NF CryptoMarket is an educational practice tool. All trading is simulated — no real money, deposits, or withdrawals. Market data is provided by third parties for study only and may be delayed or unavailable. Nothing here is financial advice or a recommendation to buy or sell. © 2026 NF CryptoMarket.</div>
      </footer>
      {modal && <Modal kind={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ================================== CSS ================================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
.app{--bg:#0e1116;--p1:#161a21;--p2:#1c222b;--p3:#222934;--bdr:#252c38;--bdr2:#323b4a;
  --tx:#e6eaf0;--mut:#8a94a6;--mut2:#5b6678;--up:#2ebd85;--dn:#f0616d;--gold:#e8b14c;--cy:#4fb7d8;--pp:#bf7af0;
  font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--tx);min-height:100vh;font-size:13px;line-height:1.4}
.mono,.app input{font-family:'IBM Plex Mono',monospace}
.pos{color:var(--up)}.neg{color:var(--dn)}.muted{color:var(--mut2)}.small{font-size:10px}.hide-sm{}

/* header */
.topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:9px 16px;
  background:linear-gradient(180deg,#11151b,#0e1116);border-bottom:1px solid var(--bdr);position:sticky;top:0;z-index:60;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;font-family:'Space Grotesk';font-weight:700;font-size:13px;
  background:linear-gradient(135deg,var(--gold),#c8902f);color:#1a1205;box-shadow:0 2px 10px rgba(232,177,76,.25)}
.bword{line-height:1.1}.bname{font-family:'Space Grotesk';font-weight:600;font-size:15px}
.btag{font-size:9px;color:var(--mut2);letter-spacing:.6px;text-transform:uppercase}
.pbadge{font-family:'IBM Plex Mono';font-size:9px;font-weight:600;letter-spacing:1.5px;color:var(--gold);border:1px solid rgba(232,177,76,.4);background:rgba(232,177,76,.08);padding:3px 7px;border-radius:4px}
.mode{display:flex;align-items:center;gap:5px;font-family:'IBM Plex Mono';font-size:9px;letter-spacing:.8px;padding:3px 8px;border-radius:4px;border:1px solid var(--bdr2);color:var(--mut)}
.mode .dot{width:6px;height:6px;border-radius:50%}
.m-live{color:var(--up);border-color:rgba(46,189,133,.35)}.m-live .dot{background:var(--up);box-shadow:0 0 6px var(--up);animation:pulse 1.6s infinite}
.m-sim{color:var(--cy);border-color:rgba(79,183,216,.35)}.m-sim .dot{background:var(--cy)}
.m-connecting .dot{background:var(--mut);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.acct{display:flex;align-items:center;gap:18px}
.ai .l{font-size:8.5px;color:var(--mut2);text-transform:uppercase;letter-spacing:.7px}
.ai .v{font-family:'IBM Plex Mono';font-weight:600;font-size:14px;margin-top:1px}
.reset{background:transparent;border:1px solid var(--bdr2);color:var(--mut);font-size:11px;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit}
.reset:hover{border-color:var(--dn);color:var(--dn)}

/* intro */
.intro{display:flex;align-items:center;gap:14px;justify-content:space-between;margin:10px 16px 0;padding:10px 14px;
  border:1px solid rgba(232,177,76,.25);background:rgba(232,177,76,.05);border-radius:9px;font-size:12px;color:#d8c9a8}
.intro strong{color:var(--gold)}.intro em{color:#e6eaf0;font-style:normal;font-weight:500}
.intro button{flex-shrink:0;background:var(--gold);color:#1a1205;border:none;font-weight:600;padding:7px 13px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px}

/* body layout */
.body{display:grid;grid-template-columns:246px 1fr 290px;gap:11px;padding:11px 16px;align-items:start}
.panel{background:var(--p1);border:1px solid var(--bdr);border-radius:10px;overflow:hidden}
.ph{padding:9px 13px;font-family:'Space Grotesk';font-weight:600;font-size:12px;border-bottom:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center}
.ph .muted{font-family:'IBM Plex Mono';font-size:9px;font-weight:400;letter-spacing:.5px;text-transform:uppercase}

/* sidebar */
.sidebar{background:var(--p1);border:1px solid var(--bdr);border-radius:10px;display:flex;flex-direction:column;overflow:hidden;max-height:calc(100vh - 130px)}
.search{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bdr)}
.search input{flex:1;background:transparent;border:none;outline:none;color:var(--tx);font-size:12.5px;font-family:'Inter'}
.search input::placeholder{color:var(--mut2)}
.sidehead{display:flex;justify-content:space-between;padding:7px 13px;font-size:9px;color:var(--mut2);text-transform:uppercase;letter-spacing:.7px;border-bottom:1px solid var(--bdr)}
.coinlist{overflow-y:auto;flex:1;scrollbar-width:thin}
.coinlist::-webkit-scrollbar{width:4px}.coinlist::-webkit-scrollbar-thumb{background:var(--bdr2);border-radius:2px}
.coin{width:100%;display:flex;justify-content:space-between;align-items:center;padding:8px 13px;background:transparent;border:none;border-bottom:1px solid rgba(37,44,56,.4);cursor:pointer;text-align:left}
.coin:hover{background:rgba(255,255,255,.025)}
.coin.on{background:rgba(232,177,76,.06);box-shadow:inset 2px 0 0 var(--gold)}
.co-b{font-family:'Space Grotesk';font-weight:600;font-size:12.5px}.co-q{color:var(--mut2);font-size:10px}
.co-r{text-align:right;line-height:1.25}
.co-p{font-family:'IBM Plex Mono';font-size:11.5px;display:block}
.co-c{font-family:'IBM Plex Mono';font-size:9.5px}
.noco{padding:24px 14px;text-align:center;color:var(--mut2);font-size:12px}
.sidefoot{padding:9px 13px;font-size:9.5px;color:var(--mut2);border-top:1px solid var(--bdr);line-height:1.5}

/* chart column */
.chartcol{background:var(--p1);border:1px solid var(--bdr);border-radius:10px;display:flex;flex-direction:column;overflow:hidden}
.chart-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--bdr)}
.ch-id{display:flex;align-items:baseline;gap:12px}
.ch-b{font-family:'Space Grotesk';font-weight:700;font-size:18px}.ch-q{color:var(--mut2);font-size:13px;font-weight:500}
.ch-last{font-family:'IBM Plex Mono';font-weight:600;font-size:18px}
.ch-chg{font-family:'IBM Plex Mono';font-size:12px}
.ch-meta{font-family:'IBM Plex Mono';font-size:10px;color:var(--mut2)}

/* toolbar */
.toolbar{display:flex;align-items:center;gap:7px;padding:8px 12px;border-bottom:1px solid var(--bdr);flex-wrap:wrap;position:relative;z-index:20}
.tf-group{display:flex;gap:3px}
.tf{background:transparent;border:1px solid var(--bdr2);color:var(--mut);font-family:'IBM Plex Mono';font-size:11px;padding:5px 10px;border-radius:6px;cursor:pointer}
.tf.on{background:rgba(232,177,76,.12);border-color:var(--gold);color:var(--gold)}
.tbsep{width:1px;height:20px;background:var(--bdr2);margin:0 3px}
.toolbtn{display:flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--bdr2);color:var(--mut);font-size:11.5px;padding:6px 11px;border-radius:6px;cursor:pointer;font-family:'Inter'}
.toolbtn:hover{border-color:var(--mut);color:var(--tx)}
.toolbtn.act{background:rgba(232,177,76,.12);border-color:var(--gold);color:var(--gold)}
.toolbtn.icon{padding:6px 8px}
.toolbtn.danger:hover{border-color:var(--dn);color:var(--dn)}
.indc{font-family:'IBM Plex Mono';font-size:9px;background:var(--gold);color:#1a1205;font-weight:600;padding:1px 5px;border-radius:8px}
.ind-wrap{position:relative}
.indmenu{position:absolute;top:38px;left:0;width:300px;background:var(--p2);border:1px solid var(--bdr2);border-radius:9px;padding:10px;z-index:40;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.im-group{font-size:9px;color:var(--mut2);text-transform:uppercase;letter-spacing:.7px;margin:6px 4px 6px}
.im-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px}
.im-item{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--tx);padding:4px 4px;border-radius:5px;cursor:pointer}
.im-item:hover{background:rgba(255,255,255,.03)}
.im-item input{accent-color:var(--gold);width:13px;height:13px;cursor:pointer}
.im-item .sw{width:11px;height:3px;border-radius:2px;flex-shrink:0}
.draw-group{display:flex;gap:3px;margin-left:auto}

.chartwrap{position:relative;flex:1;min-height:430px;padding:6px 4px 2px}
.cbase{position:absolute;inset:6px 4px 2px;pointer-events:none}
.covl{position:absolute;inset:6px 4px 2px;z-index:5}
.covl.tool-none{cursor:grab}
.covl.tool-none:active{cursor:grabbing}
.covl.tool-trend,.covl.tool-ray,.covl.tool-hline,.covl.tool-rect{cursor:crosshair}
.chart-hint{position:absolute;left:10px;bottom:6px;font-family:'IBM Plex Mono';font-size:9px;color:var(--mut2);pointer-events:none;opacity:.65;z-index:6}
.drawhint{padding:7px 14px;font-size:11px;color:var(--gold);background:rgba(232,177,76,.05);border-top:1px solid var(--bdr)}

/* right column */
.rightcol{display:flex;flex-direction:column;gap:11px}
.tp{padding:13px}
.tp-mkt{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--mut);padding-bottom:10px;border-bottom:1px solid var(--bdr);margin-bottom:11px}
.tp-mkt strong{font-family:'IBM Plex Mono';font-size:15px;color:var(--tx)}
.tp-lbl{font-size:9.5px;color:var(--mut2);text-transform:uppercase;letter-spacing:.6px}
.tp-in{display:flex;align-items:center;gap:6px;border:1px solid var(--bdr2);border-radius:7px;padding:9px 11px;margin:6px 0 8px;background:var(--bg)}
.tp-in span{color:var(--mut2)}.tp-in input{flex:1;background:transparent;border:none;outline:none;color:var(--tx);font-size:16px;width:100%}
.tp-q{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px}
.tp-q button{flex:1;min-width:42px;background:var(--p2);border:1px solid var(--bdr2);color:var(--mut);font-family:'IBM Plex Mono';font-size:11px;padding:6px 4px;border-radius:6px;cursor:pointer}
.tp-q button:hover{border-color:var(--gold);color:var(--gold)}
.tp-est{font-family:'IBM Plex Mono';font-size:11px;color:var(--mut);display:flex;justify-content:space-between;margin-bottom:12px}
.fee{color:var(--mut2)}
.tp-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tp-btns button{padding:11px;border:none;border-radius:8px;font-family:'Space Grotesk';font-weight:600;font-size:13px;cursor:pointer;color:#0e1116}
.buy{background:var(--up)}.buy:hover{filter:brightness(1.08)}.sell{background:var(--dn)}.sell:hover{filter:brightness(1.08)}
.tp-warn{margin-top:10px;font-size:11px;color:var(--dn);text-align:center}

/* book */
.book{padding:8px 10px;font-family:'IBM Plex Mono';font-size:11px}
.brow{position:relative;display:flex;justify-content:space-between;padding:2.5px 6px;z-index:1}
.bd{position:absolute;right:0;top:0;bottom:0;z-index:-1;opacity:.12;border-radius:2px}
.bd.ask{background:var(--dn)}.bd.bid{background:var(--up)}
.bs{color:var(--mut)}
.bmid{display:flex;justify-content:space-between;align-items:baseline;padding:6px;font-size:14px;font-weight:600;border-top:1px solid var(--bdr);border-bottom:1px solid var(--bdr);margin:4px 0}
.bmid span{font-size:8.5px;color:var(--mut2);font-weight:400}

/* tabs */
.tabsec{background:var(--p1);border:1px solid var(--bdr);border-radius:10px;margin:0 16px 14px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--bdr);padding:0 6px}
.tabs button{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--mut);font-family:'Space Grotesk';font-weight:500;font-size:12.5px;padding:11px 15px;cursor:pointer;display:flex;align-items:center;gap:7px}
.tabs button.on{color:var(--gold);border-bottom-color:var(--gold)}
.cnt{font-family:'IBM Plex Mono';font-size:10px;background:var(--p2);color:var(--mut);padding:1px 6px;border-radius:9px}
.tbody{padding:6px}
.empty{padding:34px;text-align:center;color:var(--mut2);font-size:12.5px}
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th{text-align:left;padding:8px 12px;color:var(--mut2);font-weight:500;font-size:9px;text-transform:uppercase;letter-spacing:.7px;border-bottom:1px solid var(--bdr)}
.tbl td{padding:9px 12px;border-bottom:1px solid rgba(37,44,56,.5)}.tbl tr:last-child td{border-bottom:none}
.mkt{font-family:'Space Grotesk';font-weight:600}.mkt span{color:var(--mut2);font-weight:500;font-size:10px}
.side{font-family:'IBM Plex Mono';font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:2px 7px;border-radius:4px}
.side.long{color:var(--up);background:rgba(46,189,133,.12)}.side.short{color:var(--dn);background:rgba(240,97,109,.12)}
.pct{font-size:10px;opacity:.7}
.closebtn{background:transparent;border:1px solid var(--bdr2);color:var(--mut);font-size:10.5px;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:inherit}
.closebtn:hover{border-color:var(--dn);color:var(--dn)}
.statsb{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;padding:14px}
.stat{background:var(--bg);border:1px solid var(--bdr);border-radius:9px;padding:13px 15px}.stat.wide{grid-column:1/-1}
.sl{font-size:9px;color:var(--mut2);text-transform:uppercase;letter-spacing:.7px}
.sv{font-family:'IBM Plex Mono';font-weight:600;font-size:20px;margin-top:4px}
.snote{font-size:11.5px;color:var(--mut);margin-top:6px;line-height:1.5}

.foot{padding:16px 22px 28px;font-size:10.5px;color:var(--mut2);text-align:center;border-top:1px solid var(--bdr);max-width:900px;margin:0 auto;line-height:1.6}

/* responsive */
@media(max-width:1100px){.body{grid-template-columns:210px 1fr 260px}}
@media(max-width:900px){
  .body{grid-template-columns:1fr}
  .sidebar{max-height:300px}
  .rightcol{flex-direction:row;flex-wrap:wrap}.rightcol .panel{flex:1;min-width:240px}
  .ai.hide-sm{display:none}
}
@media(max-width:560px){
  .btag{display:none}.toolbar{gap:5px}.draw-group{margin-left:0}
  .indmenu{width:270px}
}

/* ===== platform shell ===== */
.navbar{display:flex;align-items:center;gap:16px;padding:0 16px;height:52px;background:linear-gradient(180deg,#11151b,#0e1116);border-bottom:1px solid var(--bdr);position:sticky;top:0;z-index:80}
.navbar .brand{display:flex;align-items:center;gap:10px;flex-shrink:0}
.nav{display:flex;gap:2px;overflow-x:auto;flex:1;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.navl{background:transparent;border:none;color:var(--mut);font-family:'Space Grotesk';font-weight:500;font-size:13px;padding:8px 13px;border-radius:7px;cursor:pointer;white-space:nowrap}
.navl:hover{color:var(--tx);background:rgba(255,255,255,.03)}
.navl.on{color:var(--gold);background:rgba(232,177,76,.1)}
.navright{display:flex;align-items:center;gap:9px;flex-shrink:0}
.viewport{min-height:60vh}
.acctbar{display:flex;justify-content:space-between;align-items:center;padding:9px 16px;border-bottom:1px solid var(--bdr);background:var(--p1)}
.ab-mode{display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono';font-size:10px;color:var(--mut)}
.ab-mode .dot{width:6px;height:6px;border-radius:50%;display:inline-block}
.d-live{background:var(--up);box-shadow:0 0 6px var(--up)}.d-sim{background:var(--cy)}.d-connecting{background:var(--mut)}
.termview{display:block}

/* pages */
.page{padding:18px 20px 30px;max-width:1320px;margin:0 auto}
.page-h{margin-bottom:16px}
.page-h h1{font-family:'Space Grotesk';font-weight:700;font-size:22px;letter-spacing:-.2px}
.page-h p{color:var(--mut);font-size:12.5px;margin-top:4px;max-width:760px;line-height:1.55}
.page-h em{color:var(--gold);font-style:normal}
.simnote{margin-top:14px;padding:10px 14px;border:1px solid rgba(79,183,216,.25);background:rgba(79,183,216,.05);border-radius:8px;font-size:11.5px;color:#9fc7d8}

/* stat cards */
.statrow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}
.scard{background:var(--p1);border:1px solid var(--bdr);border-radius:10px;padding:13px 15px}
.sc-l{font-size:9px;color:var(--mut2);text-transform:uppercase;letter-spacing:.7px}
.sc-v{font-family:'IBM Plex Mono';font-weight:600;font-size:18px;margin-top:5px}
.sc-c{font-family:'IBM Plex Mono';font-size:11px;margin-top:2px}
.sc-s{font-size:10px;color:var(--mut);margin-top:2px}

.pad{padding:0}
.ph2{padding:11px 15px;font-family:'Space Grotesk';font-weight:600;font-size:13px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:9px}
.pill2{font-family:'IBM Plex Mono';font-size:9px;font-weight:400;letter-spacing:.5px;color:var(--mut2);background:var(--p2);padding:2px 7px;border-radius:7px;text-transform:uppercase}
.cap{padding:9px 15px;font-size:10px;color:var(--mut2);border-top:1px solid var(--bdr)}
.loadingbox{padding:30px;text-align:center;color:var(--mut2);font-size:12px}

/* subtabs + data table */
.subtabs{display:flex;gap:3px;padding:9px 12px;border-bottom:1px solid var(--bdr)}
.subtabs button{background:transparent;border:1px solid var(--bdr2);color:var(--mut);font-size:11.5px;padding:5px 12px;border-radius:6px;cursor:pointer;font-family:'Inter'}
.subtabs button.on{background:rgba(232,177,76,.12);border-color:var(--gold);color:var(--gold)}
.tablewrap{overflow-x:auto;max-height:560px;overflow-y:auto;scrollbar-width:thin}
.tablewrap::-webkit-scrollbar{width:5px;height:5px}.tablewrap::-webkit-scrollbar-thumb{background:var(--bdr2);border-radius:3px}
.dtbl{width:100%;border-collapse:collapse;font-size:12px}
.dtbl th{position:sticky;top:0;text-align:left;padding:9px 14px;color:var(--mut2);font-weight:500;font-size:9px;text-transform:uppercase;letter-spacing:.6px;background:var(--p1);border-bottom:1px solid var(--bdr);z-index:1}
.dtbl td{padding:9px 14px;border-bottom:1px solid rgba(37,44,56,.45)}
.dtbl tbody tr{cursor:pointer}
.dtbl tbody tr:hover{background:rgba(255,255,255,.025)}
.rk{color:var(--mut2);font-family:'IBM Plex Mono';font-size:11px;width:34px}
.mkt2 .mb{font-family:'Space Grotesk';font-weight:600;font-size:12.5px}.mkt2 .mq{color:var(--mut2);font-size:10px}
.dim{color:var(--mut)}.hide-md{}

/* indicator grids */
.indgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:11px}
.indgrid2{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:11px}
.paidcard{background:var(--p1);border:1px dashed var(--bdr2);border-radius:10px;padding:14px 16px}
.pc-h{display:flex;align-items:center;gap:8px;font-family:'Space Grotesk';font-weight:600;font-size:13px}
.pc-w{font-size:11.5px;color:var(--mut);margin:8px 0 10px;line-height:1.5}
.pc-n{font-size:10.5px;color:var(--mut2);background:var(--bg);border-left:2px solid var(--bdr2);padding:7px 10px;border-radius:0 6px 6px 0;line-height:1.5}

/* fng */
.fng{padding:18px 16px}
.fng-num{font-family:'Space Grotesk';font-weight:700;font-size:42px;line-height:1;text-align:center}
.fng-num span{font-size:15px;color:var(--mut2);font-weight:500}
.fng-lbl{text-align:center;font-family:'IBM Plex Mono';font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-top:4px}
.fng-bar{position:relative;height:8px;border-radius:5px;margin:18px 4px 6px;background:linear-gradient(90deg,#f0616d,#f5a35c,#e8b14c,#5ad19e,#2ebd85)}
.fng-needle{position:absolute;top:-4px;width:3px;height:16px;background:#fff;border-radius:2px;transform:translateX(-50%);box-shadow:0 0 6px rgba(0,0,0,.6)}
.fng-scale{display:flex;justify-content:space-between;font-size:9px;color:var(--mut2);margin:0 2px}

/* dominance */
.dombars{padding:18px 16px}
.domrow{display:flex;align-items:center;gap:10px;margin-bottom:11px}
.dl{width:46px;font-size:11px;color:var(--mut)}.dv{width:48px;text-align:right;font-size:11px}
.domtrack{flex:1;height:9px;background:var(--p2);border-radius:5px;overflow:hidden}
.domfill{height:100%;border-radius:5px}

/* heatmap */
.heatleg{display:flex;gap:16px;padding:10px 15px;font-size:10px;color:var(--mut)}
.heatleg span{display:flex;align-items:center;gap:5px}.heatleg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.heathint{margin-left:auto;color:var(--mut2);font-style:italic}
.heatcell.sel{outline:2px solid var(--gold);outline-offset:1px}
.sortbar{flex-wrap:wrap}
.rowsel{background:rgba(232,177,76,.07) !important}
.leanpill{font-family:'IBM Plex Mono';font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap}
.lean-sb{background:rgba(46,189,133,.18);color:#2ebd85}
.lean-b{background:rgba(46,189,133,.1);color:#5ad19e}
.lean-n{background:rgba(120,130,148,.12);color:var(--mut)}
.lean-s{background:rgba(240,97,109,.1);color:#f0848f}
.lean-ss{background:rgba(240,97,109,.18);color:#f0616d}
.rowopen,.rowsel .rowopen{background:transparent;border:1px solid var(--bdr2);color:var(--mut);font-size:10px;padding:3px 9px;border-radius:6px;cursor:pointer;font-family:'IBM Plex Mono';white-space:nowrap}
.rowopen:hover{border-color:var(--gold);color:var(--gold)}
.inspect-open{margin-left:auto;background:transparent;border:1px solid var(--bdr2);color:var(--mut);font-size:11px;padding:4px 11px;border-radius:6px;cursor:pointer;font-family:'Inter'}
.inspect-open:hover{border-color:var(--gold);color:var(--gold)}
.heatgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:6px;padding:6px 15px 16px}
.heatcell{border:none;border-radius:8px;padding:10px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transition:transform .1s}
.heatcell:hover{transform:translateY(-2px)}
.hc-b{font-family:'Space Grotesk';font-weight:600;font-size:11px;color:#0e1116}
.hc-r{font-family:'IBM Plex Mono';font-weight:600;font-size:14px;color:#0e1116}

/* stance */
.coinsel{background:var(--p2);border:1px solid var(--bdr2);color:var(--tx);font-family:'IBM Plex Mono';font-size:12px;padding:3px 7px;border-radius:6px;cursor:pointer}
.stance{padding:15px}
.stance-top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:11px}
.stance-label{font-family:'Space Grotesk';font-weight:700;font-size:17px}
.stance-label.bull{color:var(--up)}.stance-label.bear{color:var(--dn)}.stance-label.neu{color:var(--gold)}
.stance-counts{font-family:'IBM Plex Mono';font-size:11px;color:var(--mut2)}
.stancebar{display:flex;height:9px;border-radius:5px;overflow:hidden;margin-bottom:14px;gap:1px}
.stancebar .sb{height:100%}.sb.b{background:var(--up)}.sb.n{background:var(--bdr2)}.sb.r{background:var(--dn)}
.siglist{display:grid;grid-template-columns:1fr 1fr;gap:1px 18px}
.sigrow{display:flex;justify-content:space-between;align-items:center;padding:6px 2px;border-bottom:1px solid rgba(37,44,56,.4);font-size:12px}
.sn{color:var(--mut)}
.ss{font-family:'IBM Plex Mono';font-size:11px;font-weight:600;display:flex;align-items:center;gap:7px}
.ss.bull{color:var(--up)}.ss.bear{color:var(--dn)}.ss.neutral{color:var(--mut2)}
.ss em{font-style:normal;font-weight:400;color:var(--mut2);font-size:10px}
.stancewarn{margin:4px 15px 16px;padding:11px 13px;background:rgba(232,177,76,.05);border:1px solid rgba(232,177,76,.2);border-radius:8px;font-size:11px;color:#cbbf9f;line-height:1.55}
.stancewarn strong{color:var(--gold)}

/* ask ai */
.askai{margin-bottom:14px}
.ai-box{max-height:300px;min-height:120px;overflow-y:auto;padding:14px;scrollbar-width:thin}
.ai-box::-webkit-scrollbar{width:4px}.ai-box::-webkit-scrollbar-thumb{background:var(--bdr2)}
.ai-empty{color:var(--mut2);font-size:12px;line-height:1.6}
.ai-msg{margin-bottom:13px}
.ai-who{font-family:'IBM Plex Mono';font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:var(--mut2);margin-bottom:3px}
.ai-msg.user .ai-who{color:var(--gold)}.ai-msg.assistant .ai-who{color:var(--cy)}
.ai-text{font-size:12.5px;line-height:1.6;color:var(--tx);white-space:pre-wrap}
.ai-input{display:flex;gap:8px;padding:11px 14px;border-top:1px solid var(--bdr)}
.ai-input input{flex:1;background:var(--bg);border:1px solid var(--bdr2);border-radius:7px;padding:9px 12px;color:var(--tx);font-size:13px;outline:none;font-family:'Inter'}
.ai-input button{background:var(--gold);color:#1a1205;border:none;font-weight:600;padding:9px 18px;border-radius:7px;cursor:pointer;font-family:'Space Grotesk'}
.ai-input button:disabled{opacity:.5;cursor:default}

/* learn */
.learngrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:11px}
.learncard{background:var(--p1);border:1px solid var(--bdr);border-radius:10px;padding:15px 17px}
.learncard h3{font-family:'Space Grotesk';font-weight:600;font-size:14px;color:var(--gold);margin-bottom:7px}
.learncard p{font-size:12px;color:var(--mut);line-height:1.6}

/* footer */
.sitefoot{border-top:1px solid var(--bdr);background:var(--p1);padding:26px 20px 22px;margin-top:20px}
.sf-cols{display:grid;grid-template-columns:1.6fr 1fr 1fr 1.2fr;gap:24px;max-width:1100px;margin:0 auto 20px}
.sf-brand{display:flex;align-items:center;gap:9px;font-family:'Space Grotesk';font-weight:600;font-size:15px}
.mark.sm{width:26px;height:26px;font-size:11px}
.sf-blurb{font-size:11.5px;color:var(--mut2);margin-top:9px;line-height:1.6;max-width:280px}
.sf-slogan{font-family:'Space Grotesk';font-size:11px;color:var(--gold);letter-spacing:.3px;margin-top:6px;font-style:italic}
.newsnote{background:var(--p1);border:1px solid var(--bdr);border-radius:12px;padding:22px 24px;max-width:760px}
.nn-h{display:flex;align-items:center;gap:9px;font-family:'Space Grotesk';font-weight:600;font-size:16px;color:var(--tx);margin-bottom:12px}
.newsnote p{font-size:12.5px;color:var(--mut);line-height:1.65;margin-bottom:12px}
.news-providers{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
.np{background:var(--bg);border:1px solid var(--bdr2);border-radius:9px;padding:11px 13px}
.np-n{font-family:'Space Grotesk';font-weight:600;font-size:12.5px;color:var(--cy);margin-bottom:4px}
.np-d{font-size:11px;color:var(--mut2);line-height:1.5}
.nn-foot{color:var(--gold) !important;font-size:12px !important;margin-top:6px !important;margin-bottom:0 !important}
.newsgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:11px;margin-top:4px}
.newscard{display:block;background:var(--p1);border:1px solid var(--bdr);border-radius:11px;padding:14px 16px;text-decoration:none;transition:border-color .15s,transform .1s}
.newscard:hover{border-color:var(--bdr2);transform:translateY(-2px)}
.nc-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.nc-coin{font-family:'IBM Plex Mono';font-size:9px;font-weight:600;color:var(--gold);background:rgba(232,177,76,.1);padding:2px 7px;border-radius:20px}
.nc-time{margin-left:auto;font-family:'IBM Plex Mono';font-size:10px;color:var(--mut2)}
.nc-title{font-family:'Space Grotesk';font-weight:500;font-size:13.5px;color:var(--tx);line-height:1.4;margin-bottom:8px}
.newscard:hover .nc-title{color:var(--gold)}
.nc-src{font-size:11px;color:var(--mut2)}
.news-attrib{margin-top:18px;font-size:11px;color:var(--mut2);text-align:center}
.news-attrib a{color:var(--cy);text-decoration:none}
.news-attrib a:hover{text-decoration:underline}
.newsnote code,.nn-foot code{font-family:'IBM Plex Mono';font-size:11px;background:var(--bg);padding:1px 5px;border-radius:4px;color:var(--gold)}
@media(max-width:680px){.news-providers{grid-template-columns:1fr}}
.sf-col h4{font-family:'Space Grotesk';font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--mut);margin-bottom:11px}
.sf-col button{display:block;background:none;border:none;color:var(--mut2);font-size:12px;padding:4px 0;cursor:pointer;font-family:'Inter';text-align:left}
.sf-col button:hover{color:var(--gold)}
.sf-static{display:block;font-size:11.5px;color:var(--mut2);padding:4px 0}
.sf-legal{max-width:1100px;margin:0 auto;padding-top:16px;border-top:1px solid var(--bdr);font-size:10.5px;color:var(--mut2);line-height:1.6;text-align:center}

/* modal */
.modal-bg{position:fixed;inset:0;background:rgba(4,6,9,.7);display:grid;place-items:center;z-index:200;padding:20px}
.modal{background:var(--p1);border:1px solid var(--bdr2);border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.modal-h{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:1px solid var(--bdr);font-family:'Space Grotesk';font-weight:600;font-size:15px;position:sticky;top:0;background:var(--p1)}
.modal-h button{background:none;border:none;color:var(--mut);font-size:16px;cursor:pointer}
.modal-b{padding:16px 18px}
.modal-b p{font-size:12.5px;color:var(--mut);line-height:1.65;margin-bottom:11px}

@media(max-width:1100px){.statrow{grid-template-columns:repeat(3,1fr)}.indgrid{grid-template-columns:1fr 1fr}}
@media(max-width:760px){
  .navbar .bword{display:none}
  .statrow{grid-template-columns:1fr 1fr}.indgrid,.indgrid2{grid-template-columns:1fr}
  .siglist{grid-template-columns:1fr}
  .hide-md{display:none}
  .sf-cols{grid-template-columns:1fr 1fr;gap:18px}
  .page-h h1{font-size:19px}
}
`;
