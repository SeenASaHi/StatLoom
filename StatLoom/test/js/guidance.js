// guidance.js — 操作入口与分布式引导
// 包含：预测—验证流程（可选、可跳过、只对照不评分）、情境提示、可选探索建议。
// 所有会改变数据的操作都从这里进入，便于统一挂接预测与撤销。

import * as store from './store.js';
import * as S from './stats.js';
import { h, fmt, clear } from './util.js';

// ---------- 预测—验证 ----------

const DIR_OPTIONS = [
  { key: 'up', label: '↑ 变大' },
  { key: 'down', label: '↓ 变小' },
  { key: 'same', label: '→ 基本不变' },
];

function dirKey(before, after, eps = 1e-6) {
  const d = after - before;
  return Math.abs(d) < eps ? 'same' : d > 0 ? 'up' : 'down';
}

function dirWord(k) {
  return k === 'up' ? '上升' : k === 'down' ? '下降' : '基本不变';
}

function labelOf(options, key) {
  return options.find((o) => o.key === key)?.label ?? String(key);
}

// 统一操作入口：预测模式开启且有预测规格时先提问，否则直接执行。
export function perform({ apply, snapshot, prediction }) {
  const before = snapshot ? snapshot() : undefined;
  if (store.state.predict.mode && prediction) {
    const prev = store.state.predict.pending;
    if (prev) {
      // 上一个预测未回答就来了新操作：旧操作按“跳过”落地，再进入新的预测
      store.setPending(null);
      prev.apply();
    }
    store.setPending({ apply, snapshot, prediction, before });
    return;
  }
  apply();
}

export function answerPrediction(key) {
  const p = store.state.predict.pending;
  if (!p) return;
  store.setPending(null);
  p.apply();
  if (key === 'skip') return;
  const after = p.snapshot();
  const r = p.prediction.resolve(p.before, after);
  store.setLastResult({
    question: p.prediction.question,
    predictedLabel: labelOf(p.prediction.options, key),
    predictedKey: key,
    undoDepth: store.undoDepth(),
    ...r,
  });
}

export function skipPrediction() {
  answerPrediction('skip');
}

// ---------- 数据操作（带预测规格） ----------

export function editValue(id, value) {
  const row = store.state.rows.find((r) => r.id === id);
  if (!row || !Number.isFinite(value) || value === row.value) return;
  const old = row.value;
  perform({
    apply: () => store.applyDataOp({ type: 'setValue', id, value }),
    snapshot: () => S.mean(store.state.rows.map((r) => r.value)),
    prediction: {
      question: `把 ${id} 的成绩从 ${fmt(old)} 改为 ${fmt(value)}。先猜一猜：总体均值会怎么变？`,
      options: DIR_OPTIONS,
      resolve: (b, a) => ({
        actualLabel: dirWord(dirKey(b, a)),
        detail: `总体均值：${fmt(b)} → ${fmt(a)}`,
        focusOn: { kind: 'term', target: 'mean' },
      }),
    },
  });
}

export function moveGroup(id, group) {
  const row = store.state.rows.find((r) => r.id === id);
  if (!row || row.group === group) return;
  const from = row.group;
  perform({
    apply: () => store.applyDataOp({ type: 'setGroup', id, group }),
    snapshot: () => S.ssBetween(store.state.rows),
    prediction: {
      question: `把 ${id} 从「${from}」移到「${group}」。先猜一猜：组间平方和 SS_B 会怎么变？`,
      options: DIR_OPTIONS,
      resolve: (b, a) => ({
        actualLabel: dirWord(dirKey(b, a)),
        detail: `SS_B：${fmt(b)} → ${fmt(a)}`,
        focusOn: { kind: 'term', target: 'ssBetween' },
      }),
    },
  });
}

export function addObservation(group) {
  const rows = store.state.rows;
  const gs = S.groupStats(rows).find((g) => g.name === group);
  const value = Math.round(gs ? gs.mean : 0);
  perform({
    apply: () => store.applyDataOp({ type: 'addRow', group, value }),
    snapshot: () => S.mean(store.state.rows.map((r) => r.value)),
    prediction: {
      question: `新增一条「${group}」的观测（成绩 ${value}）。先猜一猜：总体均值会怎么变？`,
      options: DIR_OPTIONS,
      resolve: (b, a) => ({
        actualLabel: dirWord(dirKey(b, a)),
        detail: `总体均值：${fmt(b)} → ${fmt(a)}`,
        focusOn: { kind: 'term', target: 'mean' },
      }),
    },
  });
}

export function removeObservation(id) {
  const row = store.state.rows.find((r) => r.id === id);
  if (!row) return;
  perform({
    apply: () => store.applyDataOp({ type: 'removeRow', id }),
    snapshot: () => S.mean(store.state.rows.map((r) => r.value)),
    prediction: {
      question: `删除观测 ${id}（成绩 ${fmt(row.value)}）。先猜一猜：总体均值会怎么变？`,
      options: DIR_OPTIONS,
      resolve: (b, a) => ({
        actualLabel: dirWord(dirKey(b, a)),
        detail: `总体均值：${fmt(b)} → ${fmt(a)}`,
        focusOn: { kind: 'term', target: 'mean' },
      }),
    },
  });
}

export function toggleMix() {
  const to = !store.state.mixed;
  perform({
    apply: () => store.applyDataOp({ type: 'setMixed', value: to }),
    snapshot: () => S.ssBetween(store.effectiveRows()),
    prediction: {
      question: to ? '混合后，组间平方和 SS_B 会怎么变？' : '还原分组后，组间平方和 SS_B 会怎么变？',
      options: DIR_OPTIONS,
      resolve: (b, a) => ({
        actualLabel: dirWord(dirKey(b, a)),
        detail: `SS_B：${fmt(b)} → ${fmt(a)}`,
        focusOn: { kind: 'term', target: 'ssBetween' },
      }),
    },
  });
}

const LOSS_OPTIONS = [
  { key: 'mean', label: '均值' },
  { key: 'median', label: '中位数' },
  { key: 'unsure', label: '说不准' },
];

export function switchLoss(type) {
  if (store.state.loss.type === type) return;
  const name = type === 'absolute' ? '绝对损失' : '平方损失';
  perform({
    apply: () => store.setLoss({ type }),
    snapshot: () => store.scopeValues(store.state.loss.scope),
    prediction: {
      question: `切换到${name}。先猜一猜：最优解会对应哪个统计量？`,
      options: LOSS_OPTIONS,
      resolve: (values) => {
        const min = S.lossMinimum(values, type);
        if (!min) return { actualLabel: '数据为空', detail: '', focusOn: null };
        if (type === 'squared') {
          return {
            actualLabel: '均值',
            detail: `最优解 a* = ȳ = ${fmt(min.a)}，此时 L = ${fmt(min.L)}`,
            focusOn: { kind: 'term', target: 'lossOptimum' },
          };
        }
        if (min.kind === 'interval') {
          return {
            actualLabel: '中位数（一段区间）',
            detail: `n 为偶数：区间 [${fmt(min.aLo)}, ${fmt(min.aHi)}] 内取任何值损失都同样最小，中位数落在其中`,
            focusOn: { kind: 'term', target: 'lossOptimum' },
          };
        }
        return {
          actualLabel: '中位数',
          detail: `最优解 a* = 中位数 ${fmt(min.a)}`,
          focusOn: { kind: 'term', target: 'lossOptimum' },
        };
      },
    },
  });
}

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
  const cands = [];
  const rows = state.rows;
  const groups = [...new Set(rows.map((r) => r.group))];
  const decomp = S.decomposition(rows);

  if (state.focus?.kind === 'obs') {
    const d = S.deviationRows(rows).find((x) => x.id === state.focus.id);
    cands.push({
      id: 'trace-obs',
      text: `观测 ${state.focus.id} 在总平方和中贡献了 e² = ${fmt(d?.e2 ?? NaN)}。展开推导步骤，看它经过的每一步。`,
      actionLabel: '展开推导',
      action: () => {
        store.setStage('ssTotal-def', 3);
      },
    });
  }

  if (!state.mixed && groups.length >= 2 && decomp.ssB > 0) {
    const gs = S.groupStats(rows);
    cands.push({
      id: 'compare-ss',
      text: `组均值存在差异（${gs.map((g) => `${g.name} ${fmt(g.mean)}`).join('，')}）。看看组内变异有多大：展开平方和分解，比较 SS_B 与 SS_W。`,
      actionLabel: '查看分解',
      action: () => {
        store.setStage('decomp', 2);
        store.setFocus({ kind: 'term', target: 'ssBetween' });
      },
    });
  }

  if (state.loss.type === 'squared') {
    cands.push({
      id: 'try-absolute',
      text: '平方损失的最优解是均值。切换到绝对损失，看看最优解会对应哪个统计量。',
      actionLabel: '切换绝对损失',
      action: () => switchLoss('absolute'),
    });
  }

  return cands.find((c) => !state.suggestionsDismissed.has(c.id)) ?? null;
}

// ---------- 引导条渲染 ----------

export function render(state) {
  const bar = document.getElementById('guidance-bar');
  if (!bar) return;
  clear(bar);
  bar.classList.remove('is-armed', 'is-locked');

  const p = state.predict.pending;
  if (p) {
    bar.classList.add('is-armed');
    bar.append(renderPending(p));
    bar.hidden = false;
    return;
  }

  const r = state.predict.lastResult;
  if (r) {
    bar.classList.add('is-locked');
    bar.append(renderResult(r));
    bar.hidden = false;
    return;
  }

  const sug = currentSuggestion(state);
  if (sug) {
    bar.append(renderSuggestion(state, sug));
    bar.hidden = false;
    return;
  }

  bar.hidden = true;
}

function renderPending(p) {
  const wrap = h('div', { class: 'g-card' });
  wrap.append(h('span', { class: 'g-tag' }, '可选预测'));
  wrap.append(h('span', { class: 'g-question', text: p.prediction.question }));
  const opts = h('div', { class: 'g-opts' });
  for (const o of p.prediction.options) {
    opts.append(h('button', { class: 'btn btn-choice', onclick: () => answerPrediction(o.key) }, o.label));
  }
  opts.append(h('button', { class: 'btn btn-ghost', onclick: () => skipPrediction() }, '跳过预测'));
  wrap.append(opts);
  return wrap;
}

function renderResult(r) {
  const wrap = h('div', { class: 'g-card' });
  wrap.append(h('span', { class: 'g-tag' }, '预测对照'));
  wrap.append(h('span', { class: 'g-question', text: r.question }));
  wrap.append(h('span', { class: 'g-chip' }, '你的预测：' + r.predictedLabel));
  wrap.append(h('span', { class: 'g-chip g-chip-actual' }, '实际：' + r.actualLabel));
  if (r.detail) wrap.append(h('span', { class: 'g-detail', text: r.detail }));
  const opts = h('div', { class: 'g-opts' });
  if (r.focusOn) {
    opts.append(h('button', { class: 'btn', onclick: () => store.setFocus(r.focusOn) }, '查看计算来源'));
  }
  if (typeof r.undoDepth === 'number' && store.canUndo() && store.undoDepth() === r.undoDepth) {
    opts.append(
      h(
        'button',
        {
          class: 'btn btn-ghost',
          title: '回退本次操作（等价于撤销一步）',
          onclick: () => {
            store.undo();
            store.setLastResult(null);
          },
        },
        '回退'
      )
    );
  }
  opts.append(h('button', { class: 'btn btn-ghost', onclick: () => store.setLastResult(null) }, '关闭'));
  wrap.append(opts);
  return wrap;
}

function renderSuggestion(state, sug) {
  const wrap = h('div', { class: 'g-card' });
  wrap.append(h('span', { class: 'g-tag' }, '探索建议'));
  wrap.append(h('span', { class: 'g-question', text: sug.text }));
  const opts = h('div', { class: 'g-opts' });
  opts.append(h('button', { class: 'btn', onclick: () => sug.action() }, sug.actionLabel));
  opts.append(h('button', { class: 'btn btn-ghost', onclick: () => store.dismissSuggestion(sug.id) }, '忽略'));
  wrap.append(opts);
  return wrap;
}
