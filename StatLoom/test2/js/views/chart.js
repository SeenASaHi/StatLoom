// chart.js — 观测窗（分组分布点图 + 框选选区）
// 空态指向数据入口；有数据时：悬停看偏差、点击做追踪、在图上拖动框选一个数值区间，
// 选区与托盘、对象检查器联动（对应文档 §4.2 统计图行、§13.2 第 3 条）。

import * as store from './../store.js';
import * as S from './../stats.js';
import * as G from './../guidance.js';
import { h, svg, fmt, clear, showTooltip, hideTooltip, pulseSvg, seriesClass } from './../util.js';

const M = { left: 96, right: 20, top: 26, bottom: 36 };
const ROW_H = 54;

let root = null;
let lastFocusSeq = -1;
let map = null; // 当前渲染的坐标映射（框选用）
let brushing = false;

export function init(container) {
  root = container;
  window.addEventListener('pointermove', (ev) => {
    if (!brushing || !root) return;
    const preview = root.querySelector('.brush-preview');
    if (!preview || !map) return;
    const v = valueFromEvent(ev);
    if (v == null) return;
    const x1 = px(map, Math.min(map.brushFrom, v));
    const x2 = px(map, Math.max(map.brushFrom, v));
    preview.setAttribute('x', x1);
    preview.setAttribute('width', Math.max(0, x2 - x1));
    preview.setAttribute('visibility', 'visible');
  });
  window.addEventListener('pointerup', (ev) => {
    if (!brushing) return;
    brushing = false;
    const preview = root?.querySelector('.brush-preview');
    preview?.setAttribute('visibility', 'hidden');
    if (!map) return;
    const v = valueFromEvent(ev);
    if (v == null) return;
    const dx = Math.abs(px(map, v) - px(map, map.brushFrom));
    if (dx < 6) {
      store.clearSelection(); // 背景单击 = 清除选区
    } else {
      store.setSelection({ from: Math.min(map.brushFrom, v), to: Math.max(map.brushFrom, v) });
    }
  });
}

function px(m, v) {
  return m.left + ((v - m.xMin) / (m.xMax - m.xMin)) * m.plotW;
}

function valueFromEvent(ev) {
  const el = root?.querySelector('.chart-svg');
  if (!el || !map) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return null;
  const vx = ((ev.clientX - rect.left) / rect.width) * map.vbWidth;
  const t = (vx - M.left) / map.plotW;
  return map.xMin + Math.min(1, Math.max(0, t)) * (map.xMax - map.xMin);
}

export function render(state) {
  if (!root) return;
  clear(root);
  const fresh = (state.focusSeq ?? 0) !== lastFocusSeq;
  lastFocusSeq = state.focusSeq ?? 0;
  const f = state.focus;

  const rows = state.rows;
  if (!rows.length) {
    const empty = h('div', { class: 'empty-state' });
    empty.append(
      h('p', { class: 'empty-note' }, '尚未导入数据。观测窗会在数据进入后自动绘制分布。'),
      h('button', { class: 'btn', onclick: () => { store.setView('tray'); store.setImportOpen(true); } }, '打开数据入口')
    );
    root.append(empty);
    map = null;
    return;
  }

  const hint = G.hintEl(state, 'chart', '点击一个点可以追踪它；在图上拖动可框选一个数值区间，选区会与托盘和检查器联动。');
  if (hint) root.append(hint);

  const devById = new Map(S.deviationRows(rows).map((d) => [d.id, d]));
  const groupMeanByName = new Map(S.groupStats(rows).map((g) => [g.name, g.mean]));
  const { flags, fences } = S.iqrFlags(rows);
  const fenceByName = new Map(fences.map((x) => [x.name, x]));

  const groupNames = [...new Set(rows.map((r) => r.group))];
  const rowDefs = [];
  if (state.mixed) {
    rowDefs.push({ key: 'pooled', name: '全部数据', list: rows, series: 'p', mean: S.mean(rows.map((r) => r.value)), pooled: true, ghost: false });
    for (const g of groupNames) {
      const list = rows.filter((r) => r.group === g);
      rowDefs.push({ key: 'g:' + g, name: g, list, series: seriesClass(groupNames, g), mean: S.mean(list.map((r) => r.value)), pooled: false, ghost: true });
    }
  } else {
    for (const g of groupNames) {
      const list = rows.filter((r) => r.group === g);
      rowDefs.push({ key: 'g:' + g, name: g, list, series: seriesClass(groupNames, g), mean: S.mean(list.map((r) => r.value)), pooled: false, ghost: false });
    }
  }

  const values = rows.map((r) => r.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  let xMin = Math.floor(lo - span * 0.08);
  let xMax = Math.ceil(hi + span * 0.08);
  if (xMax - xMin < 4) {
    xMin -= 2;
    xMax += 2;
  }
  const width = Math.max(480, (root.clientWidth || 620) - 32);
  const height = M.top + rowDefs.length * ROW_H + M.bottom;
  const plotW = width - M.left - M.right;
  const X = (v) => M.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const clampX = (x) => Math.min(width - M.right - 24, Math.max(M.left + 24, x));
  map = { xMin, xMax, left: M.left, right: M.right, plotW, vbWidth: width, brushFrom: xMin };

  const svgRoot = svg('svg', {
    class: 'chart-svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': '按组别显示的数值分布点图；在图上拖动可框选区间',
  });

  // 网格与刻度（刻度步长自适应）
  const step = niceStep(xMax - xMin);
  for (let t = Math.ceil(xMin / step) * step; t <= xMax; t += step) {
    svgRoot.append(svg('line', { class: 'grid-line', x1: X(t), y1: M.top - 8, x2: X(t), y2: M.top + rowDefs.length * ROW_H + 6 }));
    svgRoot.append(svg('text', { class: 'axis-label', x: X(t), y: height - 12, 'text-anchor': 'middle' }, fmt(t)));
  }

  // 选区带
  const sel = state.selection;
  if (sel) {
    const [slo, shi] = sel.from <= sel.to ? [sel.from, sel.to] : [sel.to, sel.from];
    svgRoot.append(
      svg('rect', {
        class: 'select-band',
        x: X(slo),
        y: M.top - 10,
        width: Math.max(2, X(shi) - X(slo)),
        height: rowDefs.length * ROW_H + 18,
      })
    );
    svgRoot.append(
      svg('text', { class: 'select-label', x: clampX((X(slo) + X(shi)) / 2), y: M.top - 14, 'text-anchor': 'middle' }, `选区 [${fmt(slo)}, ${fmt(shi)}]`)
    );
  }

  // 聚焦“均值”时：整幅图叠加总均值参考线
  const overallMean = S.mean(values);
  if (f?.kind === 'term' && f.target === 'mean') {
    svgRoot.append(
      svg('line', {
        class: 'overall-mean',
        x1: X(overallMean),
        y1: M.top - 10,
        x2: X(overallMean),
        y2: M.top + rowDefs.length * ROW_H + 8,
        'stroke-dasharray': '4 3',
      })
    );
    svgRoot.append(svg('text', { class: 'mean-label is-focus', x: clampX(X(overallMean)), y: M.top - 14, 'text-anchor': 'middle' }, `ȳ=${fmt(overallMean)}`));
  }

  rowDefs.forEach((def, i) => {
    const rowY = M.top + i * ROW_H + ROW_H / 2;
    const g = svg('g', def.ghost ? { class: 'ghost-row' } : {});

    g.append(svg('circle', { class: `dot ${def.series}`, cx: 14, cy: rowY - 8, r: 5 }));
    const label = svg('text', { class: 'row-label', x: 26, y: rowY - 4 }, def.name);
    const note = svg('text', { class: 'row-note', x: 26, y: rowY + 11 }, `n=${def.list.length}`);
    if (!def.ghost) {
      const focusGroup = () => {
        if (!def.pooled) store.setFocus({ kind: 'group', name: def.name });
      };
      label.style.cursor = 'pointer';
      note.style.cursor = 'pointer';
      label.addEventListener('click', focusGroup);
      note.addEventListener('click', focusGroup);
    }
    g.append(label, note);

    const meanX = X(def.mean);
    const tick = svg('line', { class: `mean-tick ${def.series}`, x1: meanX, y1: rowY - 14, x2: meanX, y2: rowY + 14 });
    const mlabel = svg('text', { class: 'mean-label', x: clampX(meanX), y: rowY - 18, 'text-anchor': 'middle' }, `ȳ=${fmt(def.mean)}`);
    if (f?.kind === 'term' && (f.target === 'mean' || (f.target === 'ssBetween' && !def.pooled))) {
      tick.classList.add('is-focus');
      mlabel.classList.add('is-focus');
      if (fresh && !def.ghost) pulseSvg(tick);
    }
    g.append(tick, mlabel);

    const byValue = new Map();
    for (const r of def.list) {
      if (!byValue.has(r.value)) byValue.set(r.value, []);
      byValue.get(r.value).push(r);
    }
    const connectors = f?.kind === 'term' && (f.target === 'dev' || f.target === 'sq' || f.target === 'ssWithin');

    for (const [v, list] of byValue) {
      list.forEach((r, idx) => {
        const off = (idx - (list.length - 1) / 2) * 11;
        const cx = X(v);
        const cy = rowY + off;

        if (connectors && !def.ghost) {
          g.append(svg('line', { class: `dev-connector ${def.series}`, x1: cx, y1: cy, x2: meanX, y2: cy }));
        }

        const focusedObs = f?.kind === 'obs' && f.id === r.id;
        const focusedGroup = f?.kind === 'group' && r.group === f.name;
        const inSelection = sel && v >= Math.min(sel.from, sel.to) && v <= Math.max(sel.from, sel.to);
        const cls = `dot ${def.series}${focusedObs || focusedGroup ? ' is-focus' : ''}${inSelection ? ' is-selected' : ''}`;
        const dot = svg('circle', { class: cls, cx, cy, r: 5 });
        g.append(dot);

        if (focusedObs && !def.ghost) {
          g.append(svg('circle', { class: 'breath-ring', cx, cy, r: 9 }));
        }

        if (flags.get(r.id)) {
          g.append(svg('path', { class: 'flag-ring', d: `M ${cx} ${cy - 9} L ${cx + 9} ${cy} L ${cx} ${cy + 9} L ${cx - 9} ${cy} Z` }));
        }

        const hit = svg('circle', { class: 'dot-hit', cx, cy, r: 13 });
        hit.addEventListener('mouseenter', (ev) => {
          showTooltip(dotTip(r, devById.get(r.id), groupMeanByName.get(r.group), fenceByName.get(r.group), flags.get(r.id)), ev.clientX, ev.clientY);
        });
        hit.addEventListener('mouseleave', hideTooltip);
        hit.addEventListener('click', () => {
          hideTooltip();
          store.setFocus({ kind: 'obs', id: r.id });
        });
        g.append(hit);

        if (focusedObs && fresh) pulseSvg(dot);
      });
    }

    svgRoot.append(g);
  });

  // 框选预览层（拖动中直接更新属性，不触发重渲染）
  svgRoot.append(svg('rect', { class: 'brush-preview', x: 0, y: M.top - 10, width: 0, height: rowDefs.length * ROW_H + 18, visibility: 'hidden' }));
  svgRoot.addEventListener('pointerdown', (ev) => {
    if (ev.target?.classList?.contains('dot-hit')) return; // 点标记留给选中
    const v = valueFromEvent(ev);
    if (v == null) return;
    brushing = true;
    map.brushFrom = v;
    ev.preventDefault();
  });

  // 图例（双序列必有图例；形状键说明规则提示）
  const legend = h('div', { class: 'legend' });
  if (state.mixed) legend.append(legendItem('p', '全部数据（合并）'));
  for (const g of groupNames) {
    legend.append(legendItem(seriesClass(groupNames, g), state.mixed ? `${g}（混合前）` : g));
  }
  legend.append(h('span', { class: 'legend-item' }, h('span', { class: 'legend-diamond' }), 'IQR 规则提示'));
  root.append(legend);
  root.append(svgRoot);

  if (state.mixed) {
    root.append(h('p', { class: 'chart-note' }, '混合视图：第一行是合并后的全体数据，下面保留原来的分组视图用于对比。'));
  }
  root.append(h('p', { class: 'chart-note' }, '◇ 表示该观测按 1.5×IQR 规则偏离本组大部分取值。这只是规则提示，不代表数据错误。'));
}

function legendItem(seriesCls, text) {
  return h('span', { class: 'legend-item' }, h('span', { class: `legend-dot ${seriesCls}` }), text);
}

function niceStep(span, target = 6) {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return s * pow;
}

function dotTip(row, dev, groupMean, fence, flagged) {
  const parts = [
    `<div class="tip-title">${row.id} · ${row.group}</div>`,
    `<div class="tip-row">数值 ${fmt(row.value)}</div>`,
    `<div class="tip-row">相对总均值：e = ${fmt(row.value)} − ${fmt(dev.mean)} = ${fmt(dev.e)}，e² = ${fmt(dev.e2)}</div>`,
  ];
  if (Number.isFinite(groupMean)) {
    const ew = row.value - groupMean;
    parts.push(`<div class="tip-row">相对组均值：e_w = ${fmt(row.value)} − ${fmt(groupMean)} = ${fmt(ew)}（用于组内平方和）</div>`);
  }
  if (flagged && fence && !fence.skipped) {
    parts.push(
      `<div class="tip-note">◇ IQR 规则提示：超出本组栅栏 [${fmt(fence.lo)}, ${fmt(fence.hi)}]。这是按固定规则给出的观察入口，不代表数据错误。</div>`
    );
  }
  return parts.join('');
}
