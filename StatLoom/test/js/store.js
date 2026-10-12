// store.js — StatLoom 原型：单一状态源
// 数据操作（applyDataOp）记入撤销栈；界面状态（focus / loss / expand / 预测 等）不记入。

import { ORIGINAL_ROWS, nextId } from './data.js';
import { mean } from './stats.js';

const HINT_KEY = 'statloom.dismissedHints';

function loadDismissedHints() {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(HINT_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveDismissedHints(set) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HINT_KEY, JSON.stringify([...set]));
    }
  } catch {
    /* 忽略存储失败 */
  }
}

export const state = {
  rows: structuredClone(ORIGINAL_ROWS),
  mixed: false, // 混合分组：仅改变分组口径，行数据不改动
  focus: null, // {kind:'obs', id} | {kind:'term', target} | {kind:'group', name}
  focusSeq: 0, // 每次 setFocus 递增，视图据此决定是否重放强调动画
  loss: {
    scope: 'all', // 'all' | 组名
    type: 'squared', // 'squared' | 'absolute'
    a: Math.round(mean(ORIGINAL_ROWS.map((r) => r.value)) * 10) / 10,
  },
  card: null, // 打开的知识卡 id
  stage: { 'ssTotal-def': 0, decomp: 0 }, // 规程的校准步进板：当前推进到的步骤（0 = 仅起点）
  hintsDismissed: loadDismissedHints(),
  suggestionsDismissed: new Set(),
  predict: { mode: true, pending: null, lastResult: null },
};

const undoStack = [];

function pushUndo() {
  undoStack.push({ rows: structuredClone(state.rows), mixed: state.mixed });
  if (undoStack.length > 200) undoStack.shift();
}

export function canUndo() {
  return undoStack.length > 0;
}

export function undoDepth() {
  return undoStack.length;
}

export function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  state.rows = snap.rows;
  state.mixed = snap.mixed;
  state.focus = null;
  state.predict.lastResult = null;
  notify();
}

// ---------- 数据操作（记入撤销栈） ----------

export function applyDataOp(op) {
  switch (op.type) {
    case 'setValue': {
      const r = state.rows.find((x) => x.id === op.id);
      if (!r || r.value === op.value) return;
      pushUndo();
      r.value = op.value;
      break;
    }
    case 'setGroup': {
      const r = state.rows.find((x) => x.id === op.id);
      if (!r || r.group === op.group) return;
      pushUndo();
      r.group = op.group;
      break;
    }
    case 'addRow': {
      pushUndo();
      state.rows.push({ id: nextId(), group: op.group, value: op.value });
      break;
    }
    case 'removeRow': {
      if (!state.rows.some((x) => x.id === op.id)) return;
      pushUndo();
      state.rows = state.rows.filter((x) => x.id !== op.id);
      break;
    }
    case 'setMixed': {
      if (state.mixed === op.value) return;
      pushUndo();
      state.mixed = op.value;
      state.focus = null;
      break;
    }
    default:
      return;
  }
  notify();
}

export function resetData() {
  pushUndo();
  state.rows = structuredClone(ORIGINAL_ROWS);
  state.mixed = false;
  state.focus = null;
  state.stage = { 'ssTotal-def': 0, decomp: 0 };
  state.predict.lastResult = null;
  notify();
}

// ---------- 界面状态（不记入撤销栈） ----------

export function setFocus(focus) {
  state.focus = focus;
  state.focusSeq = (state.focusSeq ?? 0) + 1;
  notify();
}

export function clearFocus() {
  if (state.focus) setFocus(null);
}

export function setLoss(patch) {
  Object.assign(state.loss, patch);
  notify();
}

export function setCard(id) {
  state.card = id;
  notify();
}

// 校准步进板：把规程推进到第 n 步（0 = 仅起点板）
export function setStage(stepId, n) {
  state.stage[stepId] = Math.max(0, Math.floor(Number(n) || 0));
  notify();
}

export function setPredictMode(on) {
  state.predict.mode = on;
  state.predict.pending = null;
  notify();
}

export function setPending(pending) {
  state.predict.pending = pending;
  notify();
}

export function setLastResult(result) {
  state.predict.lastResult = result;
  notify();
}

export function dismissHint(id) {
  state.hintsDismissed.add(id);
  saveDismissedHints(state.hintsDismissed);
  notify();
}

export function restoreHints() {
  state.hintsDismissed.clear();
  saveDismissedHints(state.hintsDismissed);
  notify();
}

export function dismissSuggestion(id) {
  state.suggestionsDismissed.add(id);
  notify();
}

// ---------- 派生数据 ----------

export function groupNamesNow() {
  return [...new Set(state.rows.map((r) => r.group))];
}

// 损失画布的取值口径：全部数据或某一组。
export function scopeValues(scope) {
  const rows = scope === 'all' ? state.rows : state.rows.filter((r) => r.group === scope);
  return rows.map((r) => r.value);
}

// 混合视图下的等效行集：所有观测归入单一分组（仅影响分组口径，不改动行数据）。
export function effectiveRows() {
  return state.mixed ? state.rows.map((r) => ({ ...r, group: '全部数据' })) : state.rows;
}

// ---------- 订阅通知 ----------

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  fn(state); // 订阅即渲染一次
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of [...listeners]) fn(state);
}
