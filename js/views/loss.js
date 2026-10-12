// loss.js — 损失函数画布
// 数轴贡献图（线段长度 = |yᵢ − a|）+ 损失曲线 L(a) + 可拖动候选解 a + 最优解标记。
// 切换损失类型走 guidance.switchLoss（可选预测）；拖动与滑条是界面状态，不记入撤销栈。

import * as store from './../store.js';
import * as S from './../stats.js';
import * as G from './../guidance.js';
import { h, svg, fmt, clear, showTooltip, hideTooltip, seriesClass, scrollToEl } from './../util.js';

const M = { left: 64, right: 20, top: 26, bottom: 30 };
const QUANT = 0.05; // a 的量化步长

let root = null;
let map = null;
let dragging = false;
let raf = 0;
let pendingA = null;

export function init(container) {
  root = container;
  window.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const a = aFromEvent(ev);
    if (a == null) return;
    pendingA = a;
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pendingA != null) store.setLossA(pendingA);
      });
    }
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
}

function aFromEvent(ev) {
  const el = root?.querySelector('.loss-drag-svg');
  if (!el || !map) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return null;
  const vx = ((ev.clientX - rect.left) / rect.width) * map.vbWidth;
  const t = (vx - M.left) / (map.vbWidth - M.left - M.right);
  const a = map.xMin + Math.min(1, Math.max(0, t)) * (map.xMax - map.xMin);
  return Math.round(a / QUANT) * QUANT;
}

function niceStep(span, target = 6) {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return s * pow;
}

export function render(state) {
  if (!root) return;
  const prevSlider = root.querySelector('.loss-slider'); // 复用节点，避免重建打断拖动
  clear(root);

  const hint = G.hintEl(state, 'loss', '拖动 a 的标记、在图上点按或使用滑条改变候选解；切换损失函数，看最优解会变成哪个统计量。');
  if (hint) root.append(hint);

  const scope = state.loss.scope;
  const values = store.scopeValues(scope);
  if (!values.length) {
    root.append(h('p', { class: 'empty-note' }, '所选口径没有数据。'));
    return;
  }
  const type = state.loss.type;
  const groupNames = [...new Set(state.rows.map((r) => r.group))];
  const cls = scope === 'all' ? 's1' : seriesClass(groupNames, scope);
  const rows = scope === 'all' ? state.rows : state.rows.filter((r) => r.group === scope);

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(3, (hi - lo) * 0.08);
  const xMin = Math.floor(lo - pad);
  const xMax = Math.ceil(hi + pad);
  const a = Math.min(xMax, Math.max(xMin, store.lossA()));
  const f = S.lossFn(type);
  const La = f(values, a);
  const min = S.lossMinimum(values, type);

  const W = Math.max(520, (root.clientWidth || 640) - 32);
  map = { xMin, xMax, vbWidth: W };
  const plotW = W - M.left - M.right;
  const X = (v) => M.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const tickStep = niceStep(xMax - xMin);

  const grid = h('div', { class: 'loss-grid' });
  const left = h('div');
  const side = h('div', { class: 'loss-side' });

  // ---------- 数轴贡献图 ----------

  left.append(h('div', { class: 'line-h' }, '每个观测的贡献（线段长度 = |yᵢ − a|）'));
  const hLine = M.top + rows.length * 9 + M.bottom;
  const svg1 = svg('svg', { class: 'chart-svg loss-drag-svg', viewBox: `0 0 ${W} ${hLine}`, role: 'img', 'aria-label': '观测值对损失的贡献线段图' });

  for (let t = Math.ceil(xMin / tickStep) * tickStep; t <= xMax; t += tickStep) {
    svg1.append(svg('line', { class: 'grid-line', x1: X(t), y1: 4, x2: X(t), y2: hLine - M.bottom + 2 }));
    svg1.append(svg('text', { class: 'axis-label', x: X(t), y: hLine - 8, 'text-anchor': 'middle' }, fmt(t)));
  }

  const sortedRows = [...rows].sort((r1, r2) => r1.value - r2.value);
  sortedRows.forEach((r, i) => {
    const y = M.top + i * 9 + 4;
    const cx = X(r.value);
    const ax = X(a);
    svg1.append(svg('line', { class: `seg ${cls}`, x1: ax, y1: y, x2: cx, y2: y }));
    svg1.append(svg('circle', { class: `dot ${cls} segdot`, cx, cy: y, r: 3.5 }));

    const d = r.value - a;
    const hit = svg('circle', { class: 'dot-hit', cx, cy: y, r: 8 });
    hit.addEventListener('mouseenter', (ev) => {
      const contrib = type === 'absolute' ? `|y − a| = ${fmt(Math.abs(d))}` : `y − a = ${fmt(d)}，(y − a)² = ${fmt(d * d)}`;
      showTooltip(
        `<div class="tip-title">${r.id} · ${r.group}</div><div class="tip-row">y = ${fmt(r.value)}，a = ${fmt(a)}</div><div class="tip-row">${contrib}</div>`,
        ev.clientX,
        ev.clientY
      );
    });
    hit.addEventListener('mouseleave', hideTooltip);
    svg1.append(hit);
  });

  // a 标记：竖线 + 顶部三角 + 标签
  svg1.append(svg('line', { class: 'loss-a-line', x1: X(a), y1: 22, x2: X(a), y2: hLine - M.bottom + 2 }));
  svg1.append(svg('path', { class: 'loss-a-tri', d: `M ${X(a) - 5} 16 L ${X(a) + 5} 16 L ${X(a)} 23 Z` }));
  const aLabelX = Math.min(W - M.right - 30, Math.max(M.left + 30, X(a)));
  svg1.append(svg('text', { class: 'loss-a-label', x: aLabelX, y: 12, 'text-anchor': 'middle' }, `a = ${fmt(a)}`));
  svg1.addEventListener('pointerdown', (ev) => {
    dragging = true;
    const na = aFromEvent(ev);
    if (na != null) store.setLossA(na);
    ev.preventDefault();
  });

  left.append(svg1);
  left.append(
    h(
      'p',
      { class: 'chart-note' },
      type === 'absolute' ? '绝对损失下，每个观测的贡献就是线段长度。' : '平方损失下，每个观测的贡献是线段长度的平方，较远的观测权重更大。'
    )
  );

  // ---------- 损失曲线 ----------

  left.append(h('div', { class: 'line-h' }, '损失曲线 L(a)'));
  const hCurve = 240;
  const svg2 = svg('svg', { class: 'chart-svg loss-drag-svg', viewBox: `0 0 ${W} ${hCurve}`, role: 'img', 'aria-label': '损失函数曲线' });

  const N = 200;
  const pts = [];
  let maxL = 0;
  for (let i = 0; i <= N; i++) {
    const av = xMin + ((xMax - xMin) * i) / N;
    const L = f(values, av);
    pts.push({ a: av, L });
    if (L > maxL) maxL = L;
  }
  const yMax = (maxL || 1) * 1.06;
  const plotH = hCurve - M.top - M.bottom - 10;
  const Y = (L) => M.top + 10 + plotH * (1 - L / yMax);

  for (const frac of [0, 0.5, 1]) {
    const Lv = yMax * frac;
    const y = Y(Lv);
    svg2.append(svg('line', { class: 'grid-line', x1: M.left, y1: y, x2: W - M.right, y2: y }));
    svg2.append(svg('text', { class: 'axis-label', x: M.left - 8, y: y + 4, 'text-anchor': 'end' }, fmt(Lv, 0)));
  }
  for (let t = Math.ceil(xMin / tickStep) * tickStep; t <= xMax; t += tickStep) {
    svg2.append(svg('text', { class: 'axis-label', x: X(t), y: hCurve - 10, 'text-anchor': 'middle' }, fmt(t)));
  }

  if (min && min.kind === 'interval') {
    svg2.append(
      svg('rect', { class: `opt-band ${cls}`, x: X(min.aLo), y: M.top + 10, width: Math.max(2, X(min.aHi) - X(min.aLo)), height: plotH })
    );
  }

  const dAttr = pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p.a).toFixed(1)} ${Y(p.L).toFixed(1)}`).join(' ');
  svg2.append(svg('path', { class: `loss-curve ${cls}`, d: dAttr }));

  if (min) {
    const optA = min.kind === 'point' ? min.a : (min.aLo + min.aHi) / 2;
    svg2.append(svg('line', { class: 'loss-opt-line', x1: X(optA), y1: Y(min.L), x2: X(optA), y2: Y(0) }));
    svg2.append(svg('circle', { class: `dot ${cls}`, cx: X(optA), cy: Y(min.L), r: 4.5 }));
    const optText =
      min.kind === 'point' ? `最优解 ${type === 'squared' ? '均值' : '中位数'} ${fmt(min.a)}` : `最优区间 [${fmt(min.aLo)}, ${fmt(min.aHi)}]`;
    const lx = Math.min(W - M.right - 8, Math.max(M.left + 48, X(optA)));
    svg2.append(svg('text', { class: 'mean-label is-focus', x: lx, y: Y(min.L) - 10, 'text-anchor': 'middle' }, optText));
  }

  svg2.append(svg('line', { class: 'loss-a-line', x1: X(a), y1: M.top + 10, x2: X(a), y2: M.top + 10 + plotH }));
  svg2.append(svg('circle', { class: 'loss-a-dot', cx: X(a), cy: Y(La), r: 4.5 }));
  const alx = Math.min(W - M.right - 26, Math.max(M.left + 26, X(a)));
  svg2.append(svg('text', { class: 'axis-label', x: alx, y: M.top + 4, 'text-anchor': 'middle' }, `a = ${fmt(a)}`));

  const hoverLine = svg('line', { class: 'loss-hover-line', x1: 0, y1: M.top + 10, x2: 0, y2: M.top + 10 + plotH, visibility: 'hidden' });
  svg2.append(hoverLine);
  svg2.addEventListener('pointermove', (ev) => {
    if (dragging) {
      hideTooltip();
      return;
    }
    const rect = svg2.getBoundingClientRect();
    const vx = ((ev.clientX - rect.left) / rect.width) * W;
    const t = (vx - M.left) / plotW;
    if (t < 0 || t > 1) {
      hoverLine.setAttribute('visibility', 'hidden');
      hideTooltip();
      return;
    }
    const av = xMin + t * (xMax - xMin);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.a - av) < Math.abs(best.a - av)) best = p;
    hoverLine.setAttribute('x1', X(best.a));
    hoverLine.setAttribute('x2', X(best.a));
    hoverLine.setAttribute('visibility', 'visible');
    showTooltip(`<div class="tip-row">a = ${fmt(best.a)}</div><div class="tip-row">L(a) = ${fmt(best.L)}</div>`, ev.clientX, ev.clientY);
  });
  svg2.addEventListener('pointerleave', () => {
    hoverLine.setAttribute('visibility', 'hidden');
    hideTooltip();
  });
  svg2.addEventListener('pointerdown', (ev) => {
    dragging = true;
    const na = aFromEvent(ev);
    if (na != null) store.setLossA(na);
    ev.preventDefault();
  });

  left.append(svg2);

  // ---------- 侧栏 ----------

  side.append(h('div', { class: 'loss-ctl' }, h('span', null, '取值口径'), scopeSelect(state, groupNames)));

  side.append(
    h(
      'div',
      { class: 'loss-ctl' },
      h('span', null, '损失类型'),
      h('button', { class: 'btn' + (type === 'squared' ? ' active' : ''), onclick: () => { if (type !== 'squared') store.setLoss({ type: 'squared' }); } }, '平方损失'),
      h('button', { class: 'btn' + (type === 'absolute' ? ' active' : ''), onclick: () => { if (type !== 'absolute') store.setLoss({ type: 'absolute' }); } }, '绝对损失')
    )
  );

  const slider = prevSlider ?? h('input', { type: 'range', class: 'loss-slider' });
  slider.min = String(xMin);
  slider.max = String(xMax);
  slider.step = String(QUANT);
  slider.value = String(a);
  slider.title = '拖动改变候选解 a';
  slider.oninput = (ev) => {
    pendingA = parseFloat(ev.target.value);
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pendingA != null) store.setLossA(pendingA);
      });
    }
  };
  side.append(h('div', { class: 'loss-ctl' }, h('span', null, '候选解 a'), slider, h('span', { class: 'g-meta', text: fmt(a) })));

  side.append(
    h(
      'div',
      { class: 'loss-ctl' },
      h('button', { class: 'btn', onclick: () => jumpToOptimum(values, type) }, '跳到最优解'),
      h('button', { class: 'btn btn-small', onclick: () => scrollToEl('panel-formula') }, '回到分析规程')
    )
  );

  side.append(
    h(
      'div',
      { class: 'loss-tile' },
      h('div', { class: 'tile-label' }, '当前损失 L(a)'),
      h('div', { class: 'loss-value-big', text: fmt(La) }),
      h('div', { class: 'f-note', text: gapText(La, min) })
    )
  );

  side.append(
    h(
      'div',
      { class: 'loss-tile' },
      h('div', { class: 'tile-label' }, `最优解（${type === 'squared' ? '平方损失' : '绝对损失'}）`),
      h('div', { class: 'loss-opt-label', text: optimumText(min, type) })
    )
  );

  // 配置保留与比较：另一个目标的候选解独立记忆，同一 a 下的损失可直接对照
  const other = type === 'squared' ? 'absolute' : 'squared';
  const otherName = other === 'absolute' ? '绝对损失' : '平方损失';
  const otherFn = other === 'absolute' ? S.absoluteLoss : S.squaredLoss;
  side.append(
    h(
      'div',
      { class: 'loss-tile' },
      h('div', { class: 'tile-label' }, `对照：同一 a = ${fmt(a)} 在另一目标下`),
      h('div', { class: 'loss-opt-label' }, `${otherName} L(a) = ${fmt(otherFn(values, a))}`),
      h(
        'p',
        { class: 'f-note' },
        '两个目标各自的候选解配置分别保留；切换目标后原来的 a 会按目标恢复。'
      ),
      h('button', { class: 'btn btn-small', onclick: () => store.setLoss({ type: other }) }, `切到${otherName}`)
    )
  );

  if (type === 'squared') {
    const eq = h('div', { class: 'f-eq' }, 'L(a) = Σ', h('sub', null, 'i'), ' ', chipTo({ kind: 'term', target: 'sq' }, '(yᵢ − a)²'));
    side.append(
      eq,
      h(
        'p',
        { class: 'f-note' },
        `与总平方和的关系：当 a 取到 ȳ = ${fmt(S.mean(values))} 时，平方损失恰好等于 SS_T = ${fmt(S.squaredLoss(values, S.mean(values)))}。`
      )
    );
  } else {
    side.append(
      h('div', { class: 'f-eq' }, 'L(a) = Σ', h('sub', null, 'i'), ' |yᵢ − a|'),
      h('p', { class: 'f-note' }, '绝对损失的最优解是中位数：排序后正中间的值；偶数样本时，中间两个值之间的整段区间同样最优。')
    );
  }

  side.append(
    h(
      'div',
      { class: 'branch-row' },
      h('button', { class: 'btn btn-small', onclick: () => store.setCard('squared-loss') }, '📖 平方损失'),
      h('button', { class: 'btn btn-small', onclick: () => store.setCard('absolute-loss') }, '📖 绝对损失')
    )
  );

  grid.append(left, side);
  root.append(grid);
}

// ---------- 构件 ----------

function chipTo(focus, text) {
  return h('button', { class: 'f-term', title: '点击可追踪', onclick: () => store.setFocus(focus) }, text);
}

function scopeSelect(state, groupNames) {
  const sel = h('select', { class: 'loss-scope' });
  sel.append(h('option', { value: 'all' }, '全部数据'));
  for (const g of groupNames) sel.append(h('option', { value: g }, g));
  sel.value = state.loss.scope;
  sel.onchange = (ev) => {
    const scope = ev.target.value;
    const vs = store.scopeValues(scope);
    store.setLoss({ scope });
    store.setLossA(vs.length ? Math.round(S.mean(vs) / QUANT) * QUANT : 0);
  };
  return sel;
}

function jumpToOptimum(values, type) {
  const min = S.lossMinimum(values, type);
  if (!min) return;
  const target = min.kind === 'point' ? min.a : (min.aLo + min.aHi) / 2;
  store.setLossA(target);
}

function optimumText(min, type) {
  if (!min) return '—';
  if (type === 'squared') return `a* = ȳ = ${fmt(min.a)}（此时 L* = ${fmt(min.L)}）`;
  if (min.kind === 'interval') {
    return `a* ∈ [${fmt(min.aLo)}, ${fmt(min.aHi)}]（整段区间同样最优，中位数 ${fmt((min.aLo + min.aHi) / 2)} 在其中）`;
  }
  return `a* = 中位数 ${fmt(min.a)}（此时 L* = ${fmt(min.L)}）`;
}

function gapText(La, min) {
  if (!min) return '';
  const gap = La - min.L;
  if (gap <= 1e-9) return '已在最优解上，损失不能再小。';
  return `比最优解多 ${fmt(gap)}。`;
}
