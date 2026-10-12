// inspector.js — 对象检查器
// 当前选中对象的类型、真实数值、可执行动作与描述性观察。
// 落实交互语法四要素（对象 / 动作 / 状态 / 反馈）与关系类型标注（§4.1、§6.3）。

import * as store from './../store.js';
import * as S from './../stats.js';
import { h, fmt, clear } from './../util.js';

let root = null;
let lastFocusSeq = -1;

export function init(container) {
  root = container;
}

export function render(state) {
  if (!root) return;
  clear(root);
  const fresh = (state.focusSeq ?? 0) !== lastFocusSeq;
  lastFocusSeq = state.focusSeq ?? 0;
  const f = state.focus;

  if (!state.rows.length) {
    root.append(h('p', { class: 'empty-note' }, '尚未导入数据。'));
    return;
  }

  if (state.selection) root.append(selectionBlock(state, fresh));

  if (!f) {
    root.append(
      h('p', { class: 'empty-note' }, '未选择对象。点击样本、组或数字开始追踪；在观测窗拖动可以框选一个区间。')
    );
    return;
  }

  if (f.kind === 'obs') root.append(obsBlock(state, f, fresh));
  else if (f.kind === 'group') root.append(groupBlock(state, f, fresh));
  else if (f.kind === 'term') root.append(termBlock(state, f, fresh));
}

// ---------- 观测值 ----------

function obsBlock(state, f, fresh) {
  const row = state.rows.find((r) => r.id === f.id);
  if (!row) return h('p', { class: 'empty-note' }, '该对象已不存在。');
  const dev = S.deviationRows(state.rows).find((d) => d.id === f.id);
  const groupMean = S.mean(state.rows.filter((r) => r.group === row.group).map((r) => r.value));
  const { flags, fences } = S.iqrFlags(state.rows);
  const fence = fences.find((x) => x.name === row.group);

  const box = h('div', { class: 'insp' + (fresh ? ' pulse' : '') });
  box.append(typeTag('数据对象 · 观测值'));
  box.append(h('div', { class: 'insp-title' }, `样本 ${row.id}`));
  box.append(
    h(
      'div',
      { class: 'insp-grid' },
      cell('所属组', row.group),
      cell('数值', fmt(row.value)),
      cell('对总均值偏差 eᵢ', fmt(dev?.e ?? NaN)),
      cell('对本组均值偏差', fmt(row.value - groupMean))
    )
  );

  if (flags.get(row.id) && fence && !fence.skipped) {
    const note = h('div', { class: 'insp-note is-attention' });
    note.append(`◇ 按 1.5×IQR 规则超出本组容差区间 [${fmt(fence.lo)}, ${fmt(fence.hi)}]。规则提示，不代表数据错误。 `);
    note.append(bookBtn('outlier-rule', 'IQR 规则提示'));
    box.append(note);
  }

  // 数据点的交互语法：查看 / 编辑 / 定位 / 调整分组 / 移除
  const actions = h('div', { class: 'insp-actions' });
  actions.append(
    action('编辑数值', null, () => {
      store.setView('tray');
      store.setFocus({ kind: 'obs', id: row.id });
      setTimeout(() => {
        document.querySelector(`.specimen[data-id="${row.id}"] .value-input`)?.focus();
      }, 80);
    }),
    groupField(row),
    action('追踪到公式', '依赖', () => {
      store.setView('derive');
      store.setStage('ssTotal-def', 1);
      store.setFocus({ kind: 'term', target: 'dev' });
    }),
    action('移除样本', null, () => store.applyDataOp({ type: 'removeRow', id: row.id }), true)
  );
  box.append(actions);
  return box;
}

// ---------- 组别 ----------

function groupBlock(state, f, fresh) {
  const members = state.rows.filter((r) => r.group === f.name);
  if (!members.length) return h('p', { class: 'empty-note' }, '该组已不存在。');
  const gc = S.groupContributions(state.rows).find((g) => g.name === f.name);
  const { fences } = S.iqrFlags(state.rows);
  const fence = fences.find((x) => x.name === f.name);
  const outside = fence && !fence.skipped ? members.filter((r) => r.value < fence.lo || r.value > fence.hi).length : 0;

  const box = h('div', { class: 'insp' + (fresh ? ' pulse' : '') });
  box.append(typeTag('数据对象 · 组别'));
  box.append(h('div', { class: 'insp-title' }, `组「${f.name}」`));
  box.append(
    h(
      'div',
      { class: 'insp-grid' },
      cell('样本量 n', String(members.length)),
      cell('组均值 ȳₖ', fmt(gc?.mean ?? NaN)),
      cell('组间贡献 nₖ(ȳₖ−ȳ)²', fmt(gc?.contribution ?? NaN)),
      cell('容差外记录', fence && !fence.skipped ? `${outside} 件` : '样本不足')
    )
  );
  const actions = h('div', { class: 'insp-actions' });
  actions.append(
    action('追踪组间贡献', '组成', () => {
      store.setView('derive');
      store.setStage('decomp', 2);
      store.setFocus({ kind: 'term', target: 'ssBetween' });
    }),
    action('知识卡：组内与组间', '概念', () => store.setCard('within-between'))
  );
  box.append(actions);
  return box;
}

// ---------- 统计量 / 公式项 ----------

function termInfo(state, target) {
  const rows = state.rows;
  const values = rows.map((r) => r.value);
  const d = S.decomposition(store.effectiveRows());
  const mean = S.mean(values);
  const n = values.length;
  const map = {
    mean: {
      label: '均值 ȳ',
      rel: '定义关系',
      cells: [
        ['当前值', fmt(mean)],
        ['样本量 n', String(n)],
        ['性质', 'Σeᵢ = 0'],
      ],
      actions: [
        ['在规程中查看', '定义', () => { store.setView('derive'); store.setFocus({ kind: 'term', target: 'mean' }); }],
        ['知识卡：均值', '概念', () => store.setCard('mean')],
      ],
    },
    dev: {
      label: '偏差 eᵢ = yᵢ − ȳ',
      rel: '公式组成',
      cells: [
        ['定义', 'yᵢ − ȳ'],
        ['Σeᵢ', '0'],
        ['Σeᵢ²（= SS_T）', fmt(d.ssT)],
      ],
      actions: [
        ['在规程中展开第 1 步', '组成', () => { store.setView('derive'); store.setStage('ssTotal-def', 1); }],
        ['知识卡：偏差', '概念', () => store.setCard('dev')],
      ],
    },
    sq: {
      label: '平方项 eᵢ²',
      rel: '公式组成',
      cells: [
        ['定义', '(yᵢ − ȳ)²'],
        ['Σeᵢ²（= SS_T）', fmt(d.ssT)],
      ],
      actions: [['在规程中展开第 2 步', '组成', () => { store.setView('derive'); store.setStage('ssTotal-def', 2); }]],
    },
    ssTotal: {
      label: '总平方和 SS_T',
      rel: '定义关系',
      cells: [
        ['当前值', fmt(d.ssT)],
        ['定义', 'Σ(yᵢ − ȳ)²'],
        ['分解', `SS_B ${fmt(d.ssB)} ＋ SS_W ${fmt(d.ssW)}`],
      ],
      actions: [
        ['展开分解', '推导', () => { store.setView('derive'); store.setStage('decomp', 2); }],
        ['知识卡：平方和分解', '概念', () => store.setCard('ss-decomposition')],
      ],
    },
    ssBetween: {
      label: '组间平方和 SS_B',
      rel: '定义关系',
      cells: [
        ['当前值', fmt(d.ssB)],
        ['定义', 'Σₖ nₖ(ȳₖ − ȳ)²'],
        ['占比 SS_B / SS_T', `${fmt(d.ssT > 0 ? (d.ssB / d.ssT) * 100 : NaN, 1)}%`],
      ],
      actions: [
        ['在观测窗查看组均值', '映射', () => { store.setView('data'); store.setFocus({ kind: 'term', target: 'ssBetween' }); }],
        ['知识卡：组内与组间变异', '概念', () => store.setCard('within-between')],
      ],
    },
    ssWithin: {
      label: '组内平方和 SS_W',
      rel: '定义关系',
      cells: [
        ['当前值', fmt(d.ssW)],
        ['定义', 'Σₖ Σᵢ (yᵢₖ − ȳₖ)²'],
      ],
      actions: [
        ['在托盘中高亮组内偏差', '映射', () => { store.setView('data'); store.setFocus({ kind: 'term', target: 'ssWithin' }); }],
        ['知识卡：平方和分解', '概念', () => store.setCard('ss-decomposition')],
      ],
    },
    lossOptimum: {
      label: '损失最优解 a*',
      rel: '理论推导',
      cells: [['目标', state.loss.type === 'squared' ? '平方损失（最优 = 均值）' : '绝对损失（最优 = 中位数）']],
      actions: [['打开处置台', '定义', () => store.setView('loss')]],
    },
  };
  return map[target] ?? null;
}

function termBlock(state, f, fresh) {
  const info = termInfo(state, f.target);
  if (!info) return h('p', { class: 'empty-note' }, '未知对象。');
  const box = h('div', { class: 'insp' + (fresh ? ' pulse' : '') });
  box.append(typeTag(`统计量 · ${info.rel}`));
  box.append(h('div', { class: 'insp-title' }, info.label));
  box.append(h('div', { class: 'insp-grid' }, ...info.cells.map(([k, v]) => cell(k, v))));
  const actions = h('div', { class: 'insp-actions' });
  for (const [label, rel, fn] of info.actions) actions.append(action(label, rel, fn));
  box.append(actions);
  return box;
}

// ---------- 选区 ----------

function selectionBlock(state, fresh) {
  const { from, to } = state.selection;
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const sel = state.rows.filter((r) => r.value >= lo && r.value <= hi);
  const vals = sel.map((r) => r.value);
  const box = h('div', { class: 'insp insp-selection' + (fresh ? ' pulse' : '') });
  box.append(typeTag('选区 · 观测窗框选'));
  box.append(h('div', { class: 'insp-title' }, `[${fmt(lo)}, ${fmt(hi)}] · ${sel.length} 件`));
  box.append(
    h(
      'div',
      { class: 'insp-grid' },
      cell('选区样本', String(sel.length)),
      cell('均值', fmt(S.mean(vals))),
      cell('范围', vals.length ? `${fmt(Math.min(...vals))} – ${fmt(Math.max(...vals))}` : '—')
    )
  );
  const actions = h('div', { class: 'insp-actions' });
  actions.append(action('清除选区', null, () => store.clearSelection()));
  box.append(actions);
  return box;
}

// ---------- 构件 ----------

function typeTag(text) {
  return h('div', { class: 'insp-type' }, text);
}

function cell(label, value) {
  return h('div', { class: 'insp-cell' }, h('span', { class: 'insp-cell-label', text: label }), h('span', { class: 'insp-cell-value', text: value }));
}

function action(label, rel, fn, danger = false) {
  const btn = h('button', { class: 'btn btn-small' + (danger ? ' btn-danger' : ''), onclick: fn }, label);
  if (rel) btn.append(h('span', { class: 'rel-tag' }, rel));
  return btn;
}

function groupField(row) {
  const groups = store.groupNamesNow();
  const sel = h('select', {
    class: 'insp-select',
    'aria-label': '调整所属组',
    onchange: (ev) => store.applyDataOp({ type: 'setGroup', id: row.id, group: ev.target.value }),
  });
  for (const g of groups) {
    const o = h('option', { value: g }, g);
    if (g === row.group) o.selected = true;
    sel.append(o);
  }
  return h('label', { class: 'insp-field' }, h('span', { class: 'insp-field-label', text: '调整分组' }), sel);
}

function bookBtn(cardId, title) {
  return h('button', { class: 'book-btn', title: `打开知识卡：${title}`, onclick: () => store.setCard(cardId) }, '📖');
}
