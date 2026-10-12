// chart.js — 分组分布点图（SVG strip plot）
// 每个点是一条观测；悬停显示偏差贡献，点击进入追踪。
// 混合分组时：第一行是合并后的数据，原分组行以淡色保留用于对比。

import * as store from './../store.js';
import * as S from './../stats.js';
import * as G from './../guidance.js';
import { h, svg, fmt, clear, showTooltip, hideTooltip, pulseSvg, seriesClass } from './../util.js';

const M = { left: 96, right: 20, top: 26, bottom: 36 };
const ROW_H = 54;

let root = null;
let lastFocusSeq = -1;

export function init(container) {
  root = container;
}

export function render(state) {
  if (!root) return;
  clear(root);
  const seq = state.focusSeq ?? 0;
  const fresh = seq !== lastFocusSeq;
  lastFocusSeq = seq;
  const f = state.focus;

  const hint = G.hintEl(state, 'chart', '图中每个点是一条观测。点击一个点，可以看到它参与了哪些计算。');
  if (hint) root.append(hint);

  const rows = state.rows;
  if (!rows.length) {
    root.append(h('p', { class: 'empty-note' }, '没有可绘制的数据。'));
    return;
  }

  const devById = new Map(S.deviationRows(rows).map((d) => [d.id, d]));
  const groupMeanByName = new Map(S.groupStats(rows).map((g) => [g.name, g.mean]));
  const { flags, fences } = S.iqrFlags(rows);
  const fenceByName = new Map(fences.map((x) => [x.name, x]));

  const groupNames = [...new Set(rows.map((r) => r.group))];
  const rowDefs = [];
  if (state.mixed) {
    rowDefs.push({
      key: 'pooled',
      name: '全部数据',
      list: rows,
      series: 'p',
      mean: S.mean(rows.map((r) => r.value)),
      pooled: true,
      ghost: false,
    });
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
  const xMin = Math.max(0, Math.floor((lo - 5) / 10) * 10);
  const xMax = Math.min(100, Math.ceil((hi + 5) / 10) * 10);
  const width = Math.max(480, (root.clientWidth || 620) - 32);
  const height = M.top + rowDefs.length * ROW_H + M.bottom;
  const plotW = width - M.left - M.right;
  const X = (v) => M.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const clampX = (x) => Math.min(width - M.right - 24, Math.max(M.left + 24, x));

  const svgRoot = svg('svg', {
    class: 'chart-svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': '按教学方式分组的成绩分布点图',
  });

  // 网格与刻度
  for (let t = xMin; t <= xMax; t += 10) {
    svgRoot.append(svg('line', { class: 'grid-line', x1: X(t), y1: M.top - 8, x2: X(t), y2: M.top + rowDefs.length * ROW_H + 6 }));
    svgRoot.append(svg('text', { class: 'axis-label', x: X(t), y: height - 12, 'text-anchor': 'middle' }, String(t)));
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

    // 行标签：色点 + 组名 + n
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

    // 均值标记
    const meanX = X(def.mean);
    const tick = svg('line', { class: `mean-tick ${def.series}`, x1: meanX, y1: rowY - 14, x2: meanX, y2: rowY + 14 });
    const mlabel = svg('text', { class: 'mean-label', x: clampX(meanX), y: rowY - 18, 'text-anchor': 'middle' }, `ȳ=${fmt(def.mean)}`);
    if (f?.kind === 'term' && (f.target === 'mean' || (f.target === 'ssBetween' && !def.pooled))) {
      tick.classList.add('is-focus');
      mlabel.classList.add('is-focus');
      if (fresh && !def.ghost) pulseSvg(tick);
    }
    g.append(tick, mlabel);

    // 点（同值堆叠）
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
        const dot = svg('circle', { class: `dot ${def.series}${focusedObs || focusedGroup ? ' is-focus' : ''}`, cx, cy, r: 5 });
        g.append(dot);

        // 焦点样本环：唯一的状态循环（2.2s 呼吸），减动效时为静态环
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
  root.append(
    h(
      'p',
      { class: 'chart-note' },
      '◇ 表示该观测按 1.5×IQR 规则偏离本组大部分取值。这只是规则提示，不代表数据错误。 ',
      h('button', { class: 'book-btn', title: '打开知识卡：IQR 规则提示', onclick: () => store.setCard('outlier-rule') }, '📖')
    )
  );
}

function legendItem(seriesCls, text) {
  return h('span', { class: 'legend-item' }, h('span', { class: `legend-dot ${seriesCls}` }), text);
}

function dotTip(row, dev, groupMean, fence, flagged) {
  const parts = [
    `<div class="tip-title">${row.id} · ${row.group}</div>`,
    `<div class="tip-row">成绩 ${fmt(row.value)} 分</div>`,
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
