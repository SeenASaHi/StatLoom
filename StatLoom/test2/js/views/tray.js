// tray.js — 样本托盘（数据入口 + 样本架）
// 无预设数据：空态由「导入门」承担第一入口（粘贴 / 文件 / 校验 / 提交，含阈值与回退说明）。
// 有数据时：芯片式样本、组别切换、数值编辑、偏差读数、移除；选区内的样本在托盘中同步标出。

import * as store from './../store.js';
import * as S from './../stats.js';
import * as G from './../guidance.js';
import { parseRows } from './../import.js';
import { h, fmt, clear, pulse, seriesClass } from './../util.js';

let root = null;
let lastSig = '';
let lastFocusSeq = -1;
let gateText = ''; // 导入门瞬时输入（不进入 store；重建只在数据变化时发生）
let gateName = '';

export function init(container) {
  root = container;
}

export function render(state) {
  if (!root) return;
  const sig = [
    state.rows.map((r) => `${r.id}|${r.group}|${r.value}`).join(';'),
    [...state.hintsDismissed].join(','),
    state.importOpen ? 'gate' : 'tray',
    state.importOpen || !state.selection ? '' : `sel:${state.selection.from}|${state.selection.to}`,
  ].join('::');
  if (sig !== lastSig) {
    rebuild(state);
    lastSig = sig;
  }
  applyFocus(state);
}

function rebuild(state) {
  clear(root);

  const hint = G.hintEl(
    state,
    'tray',
    state.rows.length
      ? '直接修改样本数值或切换所属组，全台读数与观测窗按真实计算同步更新。'
      : '把已有数据粘贴进来，或逐条登记样本；每行一条记录。'
  );
  if (hint) root.append(hint);

  if (state.importOpen) root.append(importGate(state));

  if (state.rows.length) {
    const groups = [...new Set(state.rows.map((r) => r.group))];
    const devById = new Map(S.deviationRows(state.rows).map((d) => [d.id, d]));

    const tools = h('div', { class: 'tray-tools' });
    tools.append(h('span', { class: 'tray-count', text: `在架样本 ${state.rows.length} 件 · ${groups.length} 组` }));
    tools.append(
      h('button', { class: 'btn btn-small', onclick: () => store.setImportOpen(true) }, '重新导入数据集'),
      h(
        'button',
        {
          class: 'btn btn-small',
          onclick: () => {
            const gs = S.groupStats(state.rows);
            const v = gs.length ? Math.round(gs[0].mean) : 0;
            store.applyDataOp({ type: 'addRow', group: gs.length ? gs[0].name : '样本组', value: v });
          },
        },
        '＋ 登记样本'
      )
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
        'aria-label': `样本 ${row.id}，${row.group}，数值 ${row.value}`,
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
        onchange: (ev) => store.applyDataOp({ type: 'setGroup', id: row.id, group: ev.target.value }),
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
        step: '0.1',
        value: String(row.value),
        'aria-label': `样本 ${row.id} 数值`,
        onchange: (ev) => {
          const v = parseFloat(ev.target.value);
          if (Number.isFinite(v)) store.applyDataOp({ type: 'setValue', id: row.id, value: v });
          else {
            ev.target.classList.add('is-invalid');
            ev.target.value = String(row.value);
            setTimeout(() => ev.target.classList.remove('is-invalid'), 900);
          }
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
          { class: 'row-del', title: '移除这条样本（可撤销）', 'aria-label': `移除样本 ${row.id}`, onclick: () => store.applyDataOp({ type: 'removeRow', id: row.id }) },
          '×'
        )
      );
      chip.append(bottom);

      tray.append(chip);
    }
    root.append(tray);
  }
}

// ---------- 导入门 ----------

function importGate(state) {
  const panel = h('div', { class: 'gate-panel' });
  panel.append(
    h(
      'div',
      { class: 'gate-head' },
      h('span', { class: 'g-tag g-tag-gate' }, '导入门'),
      h('span', { class: 'gate-note', text: '阈值：至少 2 条有效记录；导入将替换当前数据集（可撤销）' })
    )
  );

  const fields = h('div', { class: 'gate-fields' });
  const nameInput = h('input', {
    class: 'gate-name',
    placeholder: '数据集名称（可选）',
    value: gateName,
    oninput: (ev) => {
      gateName = ev.target.value;
    },
  });
  const fileInput = h('input', { type: 'file', accept: '.csv,.txt,.tsv', class: 'gate-file', style: 'display:none' });
  const fileLabel = h('label', { class: 'btn btn-small' }, '选择文件（.csv / .txt）');
  fileLabel.append(fileInput);
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      gateText = String(reader.result ?? '');
      ta.value = gateText;
      updatePreview();
    };
    reader.readAsText(f);
  });
  fields.append(nameInput, fileLabel);
  panel.append(fields);

  const ta = h('textarea', {
    class: 'gate-text',
    rows: '5',
    placeholder: '每行一条：组别, 数值（也可只粘贴数值；支持逗号 / 制表符 / 分号分隔）',
  });
  ta.value = gateText;
  ta.addEventListener('input', () => {
    gateText = ta.value;
    updatePreview();
  });
  panel.append(ta);

  const preview = h('div', { class: 'gate-preview' });
  panel.append(preview);

  const commitBtn = h('button', { class: 'btn gate-commit', onclick: commit }, '导入数据集');
  const actions = h('div', { class: 'gate-actions' });
  actions.append(
    commitBtn,
    h(
      'button',
      {
        class: 'btn btn-ghost',
        onclick: () => {
          gateText = '';
          gateName = '';
          ta.value = '';
          nameInput.value = '';
          updatePreview();
        },
      },
      '清空'
    )
  );
  if (state.rows.length) {
    actions.append(h('button', { class: 'btn btn-ghost', onclick: () => store.setImportOpen(false) }, '取消'));
  }
  panel.append(actions);

  function commit() {
    const parsed = parseRows(gateText);
    if (parsed.count < 2) return;
    store.importDataset({
      name: gateName,
      columns: parsed.header ? { group: parsed.header.group, value: parsed.header.value } : undefined,
      records: parsed.records,
    });
    gateText = '';
    gateName = '';
  }

  function updatePreview() {
    const parsed = parseRows(gateText);
    clear(preview);
    const canCommit = parsed.count >= 2;
    commitBtn.disabled = !canCommit;
    commitBtn.setAttribute('aria-disabled', String(!canCommit));
    preview.append(
      h(
        'span',
        { class: 'gate-count' + (canCommit ? '' : ' is-invalid') },
        canCommit ? `有效 ${parsed.count} 条 · ${parsed.groupCount} 组` : `有效 ${parsed.count}/2 条（还差 ${2 - parsed.count} 条）`
      )
    );
    if (parsed.header) {
      preview.append(h('span', { class: 'gate-meta', text: `识别到表头：${parsed.header.group} / ${parsed.header.value}` }));
    }
    if (parsed.invalid.length) {
      const list = h('div', { class: 'gate-invalid' });
      for (const item of parsed.invalid.slice(0, 6)) {
        list.append(h('div', { class: 'gate-invalid-row' }, `第 ${item.line} 行：${item.text} —— ${item.reason}`));
      }
      if (parsed.invalid.length > 6) {
        list.append(h('div', { class: 'gate-invalid-row' }, `另有 ${parsed.invalid.length - 6} 行未列出`));
      }
      preview.append(list);
    }
  }
  updatePreview();
  return panel;
}

// ---------- 焦点与选区的视觉状态 ----------

function applyFocus(state) {
  if (!root) return;
  const fresh = (state.focusSeq ?? 0) !== lastFocusSeq;
  lastFocusSeq = state.focusSeq ?? 0;
  const f = state.focus;
  const sel = state.selection;

  for (const chip of root.querySelectorAll('.specimen')) {
    const hit = f?.kind === 'obs' && chip.dataset.id === f.id;
    chip.classList.toggle('is-focus', hit);
    chip.setAttribute('aria-pressed', hit ? 'true' : 'false');
    if (hit && fresh) {
      pulse(chip);
      chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (sel) {
      const inp = chip.querySelector('.value-input');
      const v = parseFloat(inp?.value ?? 'NaN');
      const [lo, hi] = sel.from <= sel.to ? [sel.from, sel.to] : [sel.to, sel.from];
      chip.classList.toggle('is-selected', Number.isFinite(v) && v >= lo && v <= hi);
    } else {
      chip.classList.remove('is-selected');
    }
  }

  const devTerm = f?.kind === 'term' && (f.target === 'dev' || f.target === 'sq' || f.target === 'ssWithin');
  for (const td of root.querySelectorAll('.dev-cell')) td.classList.toggle('is-focus-soft', devTerm);
}
