// Small SVG chart kit. Charts render after their container is in the DOM so they use its real width.
// Marks: 2px lines, ~10% area washes, ≤24px bars with 4px rounded tops, hairline solid grid.
// Interaction: a crosshair that snaps to the nearest date (drag to scrub on touch) and per-bar tooltips.
import { compact, money, fmtDate, fmtMonth, esc } from './ui.js';

const registry = new Map();
let seq = 0;

/** Returns a placeholder to put in the page; call mountCharts() after it's inserted. */
export function chart(spec) {
  const id = 'c' + (++seq);
  registry.set(id, spec);
  return `<div class="chart" data-chart="${id}" style="height:${spec.height || 180}px" role="img" aria-label="${esc(spec.label || 'Chart')}"></div>`;
}

export function mountCharts(root = document) {
  for (const el of root.querySelectorAll('[data-chart]')) {
    const spec = registry.get(el.dataset.chart);
    if (!spec) continue;
    const w = el.clientWidth;
    if (!w) continue;
    if (spec.type === 'bars') renderBars(el, spec, w);
    else renderLines(el, spec, w);
  }
}
export function clearCharts() { registry.clear(); }

const t = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };

function niceTicks(min, max, count = 3) {
  if (max === min) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

// ---------------------------------------------------------------- line / area
function renderLines(el, spec, W) {
  const H = spec.height || 180;
  const padT = 14, padB = 22, padL = 0, padR = 0;
  const series = spec.series.filter(s => s.points.length);
  const all = series.flatMap(s => s.points);
  if (!all.length) { el.innerHTML = ''; return; }
  const stacked = !!spec.stacked;

  // For stacked series, each series' y sits on top of the previous ones at the same x.
  const xs = [...new Set(all.map(p => p.x))].sort();
  const stackTop = {};
  const geom = series.map(s => {
    const pts = s.points.map(p => {
      const base = stacked ? (stackTop[p.x] || 0) : 0;
      const top = base + p.y;
      if (stacked) stackTop[p.x] = top;
      return { x: p.x, y: p.y, base, top };
    });
    return { s, pts };
  });

  const x0 = t(xs[0]), x1 = t(xs[xs.length - 1]);
  const ys = geom.flatMap(g => g.pts.map(p => p.top)).concat(spec.yZero || stacked ? [0] : [], spec.refLine ? [spec.refLine.y] : []);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (!spec.yZero && !stacked) { const pad = (ymax - ymin) * 0.12 || Math.abs(ymax) * 0.05 || 100; ymin -= pad; ymax += pad; }
  const { lo, hi, ticks } = niceTicks(ymin, ymax, 3);
  const X = iso => padL + (x1 === x0 ? (W - padL - padR) / 2 : ((t(iso) - x0) / (x1 - x0)) * (W - padL - padR));
  const Y = v => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  // grid (tick labels are drawn after the data, with a surface halo, so lines never cut through them)
  let tickLabels = '';
  for (const v of ticks) {
    const y = Y(v);
    svg += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`;
    if (spec.refLine && Math.abs(Y(spec.refLine.y) - y) < 12) continue; // the goal label takes this spot
    tickLabels += `<text x="0" y="${y - 4}" font-size="10.5" fill="var(--muted)" class="num" stroke="var(--surface)" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(compact(v * 1, { mask: true }))}</text>`;
  }
  // x labels: first, last, and evenly spaced months between
  const labelCount = Math.max(2, Math.min(5, Math.floor(W / 80)));
  const used = [];
  for (let i = 0; i < labelCount; i++) {
    const target = x0 + (i / (labelCount - 1)) * (x1 - x0);
    const near = xs.reduce((a, b) => Math.abs(t(b) - target) < Math.abs(t(a) - target) ? b : a, xs[0]);
    if (used.includes(near)) continue;
    used.push(near);
    const x = X(near);
    const anchor = i === 0 ? 'start' : i === labelCount - 1 ? 'end' : 'middle';
    svg += `<text x="${x}" y="${H - 5}" font-size="10.5" fill="var(--muted)" text-anchor="${anchor}">${esc(fmtMonth(near.slice(0, 7), { short: true }))}</text>`;
  }
  if (spec.todayX && spec.todayX > xs[0] && spec.todayX < xs[xs.length - 1]) {
    const x = X(spec.todayX);
    svg += `<line x1="${x}" x2="${x}" y1="${padT - 6}" y2="${H - padB}" stroke="var(--base)" stroke-width="1"/>`;
    svg += `<text x="${x + 4}" y="${padT - 2}" font-size="10.5" fill="var(--muted)">Today</text>`;
  }
  // areas then lines
  for (const { s, pts } of geom) {
    if (pts.length < 1) continue;
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.top).toFixed(1)}`).join('');
    if (s.area) {
      const baseLine = pts.slice().reverse().map(p => `L${X(p.x).toFixed(1)},${Y(stacked ? p.base : lo).toFixed(1)}`).join('');
      const gid = `g${el.dataset.chart}${s.key}`;
      svg += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="${s.areaOpacity ?? .16}"/><stop offset="1" stop-color="${s.color}" stop-opacity="${stacked ? (s.areaOpacity ?? .16) : 0.02}"/></linearGradient></defs>`;
      svg += `<path d="${line}${baseLine}Z" fill="url(#${gid})"/>`;
    }
    svg += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="5 5"' : ''}/>`;
    if (pts.length === 1) svg += `<circle cx="${X(pts[0].x)}" cy="${Y(pts[0].top)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  // end dots (2px surface ring so they stay legible where lines cross)
  for (const g of geom.filter(g => g.s.endDot && g.pts.length > 1)) {
    const p = g.pts.find(q => q.x === g.s.endDot) || g.pts[g.pts.length - 1];
    svg += `<circle cx="${X(p.x)}" cy="${Y(p.top)}" r="4.5" fill="${g.s.color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  // milestone markers
  for (const mk of spec.marks || []) {
    const top = geom[geom.length - 1].pts;
    const near = top.reduce((a, b) => Math.abs(t(b.x) - t(mk.x)) < Math.abs(t(a.x) - t(mk.x)) ? b : a, top[0]);
    svg += `<circle cx="${X(mk.x)}" cy="${Y(near.top)}" r="4" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/>`;
  }
  // goal / reference line: solid, labeled, ink-colored so it doesn't read as a data series
  if (spec.refLine) {
    const y = Y(spec.refLine.y);
    svg += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--ink-2)" stroke-width="1.5"/>`;
    // Left side: the data usually starts low there, and the right end is where a goal gets reached.
    tickLabels += `<text x="0" y="${y - 5}" font-size="11" font-weight="650" fill="var(--ink-2)" stroke="var(--surface)" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(spec.refLine.label)}</text>`;
  }
  svg += tickLabels;
  svg += `<g class="hover" opacity="0"><line class="cx" y1="${padT}" y2="${H - padB}" stroke="var(--ink-2)" stroke-width="1"/>`;
  for (const g of geom) svg += `<circle class="hd" r="4.5" fill="${g.s.color}" stroke="var(--surface)" stroke-width="2"/>`;
  svg += `</g></svg><div class="tip"></div>`;
  el.innerHTML = svg;

  // ---- crosshair: snaps to the nearest x; drag to scrub on touch
  const hover = el.querySelector('.hover');
  const cx = el.querySelector('.cx');
  const dots = [...el.querySelectorAll('.hd')];
  const tip = el.querySelector('.tip');
  const show = clientX => {
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    let best = xs[0];
    for (const x of xs) if (Math.abs(X(x) - px) < Math.abs(X(best) - px)) best = x;
    const xx = X(best);
    cx.setAttribute('x1', xx); cx.setAttribute('x2', xx);
    const values = [];
    geom.forEach((g, i) => {
      const p = g.pts.find(q => q.x === best);
      if (!p) { dots[i].setAttribute('opacity', 0); return; }
      dots[i].setAttribute('opacity', 1);
      dots[i].setAttribute('cx', xx); dots[i].setAttribute('cy', Y(p.top));
      values.push({ key: g.s.key, label: g.s.label, color: g.s.color, y: p.y, top: p.top });
    });
    hover.setAttribute('opacity', 1);
    const info = { x: best, values };
    tip.innerHTML = spec.tooltip ? spec.tooltip(info) : defaultTip(info);
    tip.classList.add('on');
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(xx, tw / 2), W - tw / 2) + 'px';
    tip.style.top = (-tip.offsetHeight - 6) + 'px';
    spec.onScrub?.(info);
  };
  const hide = () => { hover.setAttribute('opacity', 0); tip.classList.remove('on'); spec.onScrub?.(null); };
  el.onpointerdown = e => { try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ } show(e.clientX); };
  el.onpointermove = e => { if (e.pointerType === 'mouse' || e.buttons) show(e.clientX); };
  el.onpointerup = el.onpointercancel = e => { if (e.pointerType !== 'mouse') setTimeout(hide, 900); };
  el.onpointerleave = e => { if (e.pointerType === 'mouse') hide(); };
}

function defaultTip({ x, values }) {
  return `<div>${esc(fmtDate(x, { year: true }))}</div>` + values.map(v =>
    `<div class="k"><i style="background:${v.color}"></i><b style="display:inline">${esc(money(v.y, { whole: true }))}</b>&nbsp;<span style="opacity:.7">${esc(v.label)}</span></div>`).join('');
}

// ---------------------------------------------------------------- bars
function renderBars(el, spec, W) {
  const H = spec.height || 150;
  const padT = 22, padB = 22;
  const bars = spec.bars;
  if (!bars.length) { el.innerHTML = ''; return; }
  const max = Math.max(1, ...bars.map(b => Math.max(b.value, b.target || 0)));
  const { hi, ticks } = niceTicks(0, max, 2);
  const band = W / bars.length;
  const bw = Math.min(24, band * 0.56);
  const Y = v => padT + (1 - Math.max(0, v) / hi) * (H - padT - padB);
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (const v of ticks) {
    if (v === 0) continue;
    svg += `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/>`;
    svg += `<text x="0" y="${Y(v) - 4}" font-size="10.5" fill="var(--muted)">${esc(compact(v))}</text>`;
  }
  svg += `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--base)"/>`;
  bars.forEach((b, i) => {
    const cx = band * i + band / 2;
    const x = cx - bw / 2;
    const y = Y(b.value), y0 = Y(0);
    const h = Math.max(0, y0 - y);
    const r = Math.min(4, h, bw / 2);
    const fill = b.highlight ? spec.color : spec.dimColor || spec.color;
    if (h > 0) svg += `<path d="M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y0}Z" fill="${fill}"/>`;
    if (b.target) svg += `<line x1="${cx - bw / 2 - 5}" x2="${cx + bw / 2 + 5}" y1="${Y(b.target)}" y2="${Y(b.target)}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" opacity=".55"/>`;
    if (b.highlight) svg += `<text x="${cx}" y="${Math.min(y, b.target ? Y(b.target) : y) - 7}" font-size="11" font-weight="650" fill="var(--ink)" text-anchor="middle">${esc(compact(b.value))}</text>`;
    svg += `<text x="${cx}" y="${H - 5}" font-size="10.5" fill="${b.highlight ? 'var(--ink)' : 'var(--muted)'}" font-weight="${b.highlight ? 650 : 400}" text-anchor="middle">${esc(b.label)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${band * i}" y="0" width="${band}" height="${H}" fill="transparent"/>`;
  });
  svg += `</svg><div class="tip"></div>`;
  el.innerHTML = svg;
  const tip = el.querySelector('.tip');
  let timer;
  const show = i => {
    const b = bars[i];
    tip.innerHTML = spec.tooltip ? spec.tooltip(b) : `<b>${esc(money(b.value, { whole: true }))}</b>${esc(b.label)}`;
    tip.classList.add('on');
    const tw = tip.offsetWidth;
    const cx = band * i + band / 2;
    tip.style.left = Math.min(Math.max(cx, tw / 2), W - tw / 2) + 'px';
    tip.style.top = (-tip.offsetHeight - 4) + 'px';
    clearTimeout(timer);
  };
  el.onpointermove = e => { const h = e.target.closest?.('.hit'); if (h) show(+h.dataset.i); };
  el.onpointerdown = e => { const h = e.target.closest?.('.hit'); if (h) { show(+h.dataset.i); spec.onTap?.(bars[+h.dataset.i]); } };
  el.onpointerleave = () => tip.classList.remove('on');
  el.onpointerup = e => { if (e.pointerType !== 'mouse') timer = setTimeout(() => tip.classList.remove('on'), 1400); };
}

// ---------------------------------------------------------------- HTML-only marks
/** Part-to-whole bar with 2px gaps. parts: [{ cents, color, label }] */
export function stackBar(parts, { tall = false } = {}) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.cents), 0);
  if (!total) return `<div class="stack${tall ? ' tall' : ''}"><i style="flex:1;background:var(--surface-3)"></i></div>`;
  return `<div class="stack${tall ? ' tall' : ''}">${parts.filter(p => p.cents > 0).map(p =>
    `<i style="flex:${p.cents};background:${p.color}" title="${esc(p.label)}"></i>`).join('')}</div>`;
}

/** Meter: fill against a limit, optional pace tick. */
export function meter(frac, { color = 'var(--ink)', pace = null, thin = false } = {}) {
  const f = Math.max(0, Math.min(1, frac || 0));
  return `<div class="meter${thin ? ' thin' : ''}"><i style="width:${(f * 100).toFixed(2)}%;background:${color}"></i>${pace != null ? `<span class="pace" style="left:calc(${(Math.max(0, Math.min(1, pace)) * 100).toFixed(2)}% - 1px)"></span>` : ''}</div>`;
}

export const seriesColor = slot => `var(--s${((slot - 1) % 8) + 1})`;
