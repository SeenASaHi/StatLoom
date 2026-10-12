// guidance.js — 分布式引导：情境提示 + 可选探索建议 + 操作状态反馈
// 无评分、无强制下一步；建议可忽略；状态反馈只报告真实结果并可随时关闭。

import * as store from './store.js';
import * as S from './stats.js';
import { h, fmt, clear } from './util.js';

// ---------- 情境提示 ----------

export function hintEl(state, id, text) {
  if (state.hintsDismissed.has(id)) return null;
  return h(
    'div',
    { class: 'hint' },
    h('span', { class: 'hint-text', text }),
    h('button', { class: 'hint-close', title: '关闭提示', onclick: () => store.dismissHint(id) }, '×')
  );
}

// ---------- 可选探索建议 ----------

export function currentSuggestion(state) {
  const rows = state.rows;
  if (!rows.length) {
    return {
      id: 'import-first',
      text: '还没有数据。在托盘视图登记样本，或粘贴一批「组别, 数值」立即开始。',
      actionLabel: '打开数据入口',
      action: () => {
        store.setView('tray');
        store.setImportOpen(true);
      },
    };
  }

  const groups = [...new Set(rows.map((r) => r.group))];
  const cands = [];

  if (state.focus?.kind === 'obs') {
    const d = S.deviationRows(rows).find((x) => x.id === state.focus.id);
    cands.push({
      id: 'trace-obs',
      text: `观测 ${state.focus.id} 在总平方和中贡献了 e² = ${fmt(d?.e2 ?? NaN)}。可到推导视图看它经过的每一步。`,
      actionLabel: '在推导中查看',
      action: () => {
        store.setView('derive');
        store.setStage('ssTotal-def', 3);
      },
    });
  }

  if (!state.mixed && groups.length >= 2) {
    const d = S.decomposition(rows);
    if (d.ssB > 0) {
      cands.push({
        id: 'compare-ss',
        text: `组均值存在差异（${S.groupStats(rows)
          .map((g) => `${g.name} ${fmt(g.mean)}`)
          .join('，')}）。比较组内变异有多大：展开平方和分解看 SS_B 与 SS_W。`,
        actionLabel: '查看分解',
        action: () => {
          store.setView('derive');
          store.setStage('decomp', 2);
          store.setFocus({ kind: 'term', target: 'ssBetween' });
        },
      });
    }
  }

  if (state.loss.type === 'squared') {
    cands.push({
      id: 'try-absolute',
      text: '平方损失的最优解是均值。切到绝对损失对比最优解；两个目标各自的候选解配置会分别保留。',
      actionLabel: '切到绝对损失',
      action: () => {
        store.setView('loss');
        store.setLoss({ type: 'absolute' });
      },
    });
  } else {
    cands.push({
      id: 'try-squared',
      text: '绝对损失的最优解是中位数（偶数样本时为一段区间）。回到平方损失，对照两个目标的最优解。',
      actionLabel: '回到平方损失',
      action: () => {
        store.setView('loss');
        store.setLoss({ type: 'squared' });
      },
    });
  }

  return cands.find((c) => !state.suggestionsDismissed.has(c.id)) ?? null;
}

// ---------- 底部条：状态反馈优先，其次建议 ----------

export function render(state) {
  const bar = document.getElementById('guidance-bar');
  if (!bar) return;
  clear(bar);

  const st = state.status;
  if (st) {
    bar.append(renderStatus(st));
    bar.hidden = false;
    return;
  }

  const sug = currentSuggestion(state);
  if (sug) {
    bar.append(renderSuggestion(sug));
    bar.hidden = false;
    return;
  }

  bar.hidden = true;
}

function renderStatus(st) {
  const wrap = h('div', { class: 'g-card' });
  wrap.append(h('span', { class: 'g-tag g-tag-status' }, '状态'));
  wrap.append(h('span', { class: 'g-question', text: st.text }));
  const opts = h('div', { class: 'g-opts' });
  if (st.canUndo && store.canUndo()) {
    opts.append(h('button', { class: 'btn', onclick: () => store.undo() }, '撤销'));
  }
  if (st.canRedo && store.canRedo()) {
    opts.append(h('button', { class: 'btn', onclick: () => store.redo() }, '重做'));
  }
  opts.append(h('button', { class: 'btn btn-ghost', onclick: () => store.clearStatus() }, '关闭'));
  wrap.append(opts);
  return wrap;
}

function renderSuggestion(sug) {
  const wrap = h('div', { class: 'g-card' });
  wrap.append(h('span', { class: 'g-tag' }, '探索建议'));
  wrap.append(h('span', { class: 'g-question', text: sug.text }));
  const opts = h('div', { class: 'g-opts' });
  opts.append(h('button', { class: 'btn', onclick: () => sug.action() }, sug.actionLabel));
  opts.append(h('button', { class: 'btn btn-ghost', onclick: () => store.dismissSuggestion(sug.id) }, '忽略'));
  wrap.append(opts);
  return wrap;
}
