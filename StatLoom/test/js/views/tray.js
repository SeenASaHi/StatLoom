// tray.js — 样本托盘（原数据表）
// 每个样本是一块芯片：编号、组别切换、数值编辑、偏差读数、移除、登记新样本。
// 选中样本获得测量内嵌缘，与观测窗、规程、复核台联动；芯片本身是键盘可达的选择控件。

import * as store from './../store.js';
import * as S from './../stats.js';
import * as G from './../guidance.js';
import { h, fmt, clear, pulse, seriesClass } from './../util.js';

let root = null;
let lastSig = '';
let lastFocusSeq = -1;

export function init(container) {
  root = container;
}

export function render(state) {
  if (!root) return;
  const sig =
    state.rows.map((r) => `${r.id}|${r.group}|${r.value}`).join(';') + '::' + [...state.hintsDismissed].join(',');
  if (sig !== lastSig) {
    rebuild(state);
    lastSig = sig;
  }
  applyFocus(state);
}

function rebuild(state) {
  clear(root);
  const groups = [...new Set(state.rows.map((r) => r.group))];
  const devById = new Map(S.deviationRows(state.rows).map((d) => [d.id, d]));

  const hint = G.hintEl(state, 'tray', '直接修改样本数值或切换所属组，全台读数与观测窗按真实计算同步更新；点击样本可在各处定位它。');
  if (hint) root.append(hint);

  const tools = h('div', { class: 'tray-tools' });
  tools.append(h('span', { class: 'tray-count', text: `在架样本 ${state.rows.length} 件` }));
  tools.append(
    h('button', { class: 'btn btn-small', onclick: () => G.addObservation(groups[0] ?? '全部') }, '＋ 登记新样本')
  );
  root.append(tools);

  const tray = h('div', { class: 'tray' });
  for (const row of state.rows) {
    const d = devById.get(row.id);
    const chip = h('div', {
      class: 'specimen',
      dataset: { id: row.id },
      tabindex: '0',
      role: 'button',
      'aria-label': `样本 ${row.id}，${row.group}，成绩 ${row.value}`,
      onclick: (ev) => {
        if (ev.target.closest('input,select,button')) return;
        store.setFocus({ kind: 'obs', id: row.id });
      },
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          store.setFocus({ kind: 'obs', id: row.id });
        }
      },
    });

    const top = h('div', { class: 'sp-top' });
    top.append(h('span', { class: 'sp-id', text: row.id }));
    top.append(h('span', { class: `legend-dot ${seriesClass(groups, row.group)}`, 'aria-hidden': 'true' }));
    const sel = h('select', {
      class: 'group-select',
      'aria-label': `样本 ${row.id} 所属组`,
      onchange: (ev) => G.moveGroup(row.id, ev.target.value),
    });
    for (const g of groups) {
      const opt = h('option', { value: g }, g);
      if (g === row.group) opt.selected = true;
      sel.append(opt);
    }
    top.append(sel);
    chip.append(top);

    const inp = h('input', {
      class: 'value-input',
      type: 'number',
      step: '1',
      value: String(row.value),
      'aria-label': `样本 ${row.id} 成绩`,
      onchange: (ev) => {
        const v = parseFloat(ev.target.value);
        if (Number.isFinite(v)) G.editValue(row.id, v);
        else ev.target.value = String(row.value);
      },
      onkeydown: (ev) => {
        if (ev.key === 'Enter') ev.target.blur();
      },
    });
    chip.append(inp);

    const bottom = h('div', { class: 'sp-bottom' });
    bottom.append(h('span', { class: 'dev-cell', title: '相对总均值的偏差 eᵢ = yᵢ − ȳ', text: `e ${fmt(d?.e ?? NaN)}` }));
    bottom.append(
      h(
        'button',
        { class: 'row-del', title: '移除这条样本（可撤销）', 'aria-label': `移除样本 ${row.id}`, onclick: () => G.removeObservation(row.id) },
        '×'
      )
    );
    chip.append(bottom);

    tray.append(chip);
  }
  root.append(tray);

  if (!state.rows.length) root.append(h('p', { class: 'empty-note' }, '托盘为空。点击「＋ 登记新样本」恢复。'));
}

function applyFocus(state) {
  if (!root) return;
  const seq = state.focusSeq ?? 0;
  const fresh = seq !== lastFocusSeq;
  lastFocusSeq = seq;
  const f = state.focus;

  for (const chip of root.querySelectorAll('.specimen')) {
    const hit = f?.kind === 'obs' && chip.dataset.id === f.id;
    chip.classList.toggle('is-focus', hit);
    chip.setAttribute('aria-pressed', hit ? 'true' : 'false');
    if (hit && fresh) {
      pulse(chip);
      chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  const devTerm = f?.kind === 'term' && (f.target === 'dev' || f.target === 'sq' || f.target === 'ssWithin');
  for (const td of root.querySelectorAll('.dev-cell')) td.classList.toggle('is-focus-soft', devTerm);
}
