// store.js — StatLoom 原型二：单一状态源
// 数据（数据集 / 行 / 导入）与探索状态（焦点 / 选区 / 视图 / 路径 / 规程阶段 / 损失配置）
// 统一维护；数据操作与视图调整区分管理：视图、选区、路径不进入撤销栈（对应文档 §7.3）。
// 撤销 + 重做双栈；数据集与损失配置持久化到 localStorage（分析配置保存）。

import { DEFAULT_DATASET_NAME, emptyDataset } from './data.js';
import { mean } from './stats.js';

const PERSIST_KEY = 'statloom2.persist';
const HINT_KEY = 'statloom2.dismissedHints';

const TERM_LABELS = {
  mean: '均值 ȳ',
  ssTotal: 'SS_T',
  ssBetween: 'SS_B',
  ssWithin: 'SS_W',
  dev: '偏差 eᵢ',
  sq: '平方项 eᵢ²',
  lossOptimum: '最优解',
};

function loadHints() {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(HINT_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveHints(set) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HINT_KEY, JSON.stringify([...set]));
  } catch {
    /* 忽略 */
  }
}

function loadInitial() {
  const base = {
    dataset: emptyDataset(),
    rows: [],
    mixed: false,
    focus: null,
    focusSeq: 0,
    selection: null, // {from, to}：观测窗框选出的数值区间
    view: 'data', // 'data' | 'derive' | 'loss'
    path: [], // 探索路径 [{key, label, focus}]
    stage: { 'ssTotal-def': 0, decomp: 0 },
    loss: { scope: 'all', type: 'squared', aByType: { squared: 70, absolute: 70 } },
    card: null,
    deriveWindow: null, // 推导次级窗口 {card: 'ssTotal-def' | 'decomp'} | null
    importOpen: true, // 无预设数据：默认打开导入门
    hintsDismissed: loadHints(),
    suggestionsDismissed: new Set(),
    status: null, // 操作状态反馈 {text, undoable?, redo?, undo?}
  };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && Array.isArray(saved.rows)) {
          base.dataset = saved.dataset ?? base.dataset;
          base.rows = saved.rows;
          base.stage = { ...base.stage, ...(saved.stage ?? {}) };
          if (saved.loss) {
            base.loss = { ...base.loss, ...saved.loss, aByType: { ...base.loss.aByType, ...(saved.loss.aByType ?? {}) } };
          }
          base.importOpen = saved.rows.length === 0;
        }
      }
    }
  } catch {
    /* 忽略损坏的存储 */
  }
  if (!base.rows.length) base.importOpen = true;
  // 空数据落在托盘（导入门即入口）；有数据落在数据视图
  base.view = base.rows.length ? 'data' : 'tray';
  return base;
}

export const state = loadInitial();

let idSeq = 1;
(function syncIdSeq() {
  let max = 0;
  for (const r of state.rows) {
    const m = /^r(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  idSeq = max + 1;
})();

function nextRowId() {
  return 'r' + String(idSeq++).padStart(2, '0');
}

function persist() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ dataset: state.dataset, rows: state.rows, stage: state.stage, loss: state.loss })
    );
  } catch {
    /* 忽略 */
  }
}

// ---------- 撤销 / 重做 ----------

const undoStack = [];
const redoStack = [];

function snapshot() {
  return { dataset: structuredClone(state.dataset), rows: structuredClone(state.rows), mixed: state.mixed };
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0; // 新的数据操作使重做失效
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

function validateDependentState() {
  const f = state.focus;
  if (f?.kind === 'obs' && !state.rows.some((r) => r.id === f.id)) state.focus = null;
  if (f?.kind === 'group' && !state.rows.some((r) => r.group === f.name)) state.focus = null;
  if (state.loss.scope !== 'all' && !state.rows.some((r) => r.group === state.loss.scope)) state.loss.scope = 'all';
}

function applySnapshot(s, statusText) {
  state.dataset = s.dataset;
  state.rows = s.rows;
  state.mixed = s.mixed;
  state.status = statusText ? { text: statusText, canRedo: /撤销/.test(statusText), canUndo: /重做/.test(statusText) } : state.status;
  validateDependentState();
  persist();
  notify();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  applySnapshot(undoStack.pop(), '已撤销上一步操作');
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  applySnapshot(redoStack.pop(), '已重做');
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
      state.rows.push({ id: nextRowId(), group: op.group, value: op.value });
      break;
    }
    case 'removeRow': {
      if (!state.rows.some((x) => x.id === op.id)) return;
      pushUndo();
      state.rows = state.rows.filter((x) => x.id !== op.id);
      if (state.focus?.kind === 'obs' && state.focus.id === op.id) state.focus = null;
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
  validateDependentState();
  persist();
  notify();
}

// 导入数据集：替换当前数据集（原始数据整体更新）；可撤销。
export function importDataset({ name, columns, records }) {
  pushUndo();
  state.dataset = {
    name: (name ?? '').trim() || DEFAULT_DATASET_NAME,
    columns: columns ?? { group: '分组', value: '数值' },
  };
  idSeq = 1;
  state.rows = records.map((r) => ({ id: nextRowId(), group: r.group, value: r.value }));
  state.mixed = false;
  state.focus = null;
  state.selection = null;
  state.path = [];
  state.stage = { 'ssTotal-def': 0, decomp: 0 };
  state.loss.scope = 'all';
  const m = mean(state.rows.map((r) => r.value));
  const rounded = Math.round((Number.isFinite(m) ? m : 70) * 2) / 2;
  state.loss.aByType = { squared: rounded, absolute: rounded };
  state.importOpen = false;
  state.deriveWindow = null;
  state.view = 'data'; // 导入完成后直达观测分布
  state.status = {
    text: `已导入 ${state.rows.length} 条记录 · ${new Set(state.rows.map((r) => r.group)).size} 组`,
    canUndo: true,
  };
  persist();
  notify();
}

// 恢复为空数据集（可撤销）。
export function resetAll() {
  pushUndo();
  state.dataset = emptyDataset();
  state.rows = [];
  state.mixed = false;
  state.focus = null;
  state.selection = null;
  state.path = [];
  state.stage = { 'ssTotal-def': 0, decomp: 0 };
  state.deriveWindow = null;
  state.importOpen = true;
  state.view = 'tray';
  state.status = { text: '已恢复为空数据集', canUndo: true };
  persist();
  notify();
}

// ---------- 探索状态（不记入撤销栈） ----------

export function setView(view) {
  if (state.view === view) return;
  state.view = view;
  notify();
}

export function setFocus(focus) {
  state.focus = focus;
  state.focusSeq = (state.focusSeq ?? 0) + 1;
  if (focus) {
    const label =
      focus.kind === 'obs' ? focus.id : focus.kind === 'group' ? focus.name : TERM_LABELS[focus.target] ?? focus.target;
    const key = JSON.stringify(focus);
    const last = state.path[state.path.length - 1];
    if (!last || last.key !== key) {
      state.path.push({ key, label, focus });
      if (state.path.length > 10) state.path.shift();
    }
  }
  notify();
}

export function clearFocus() {
  if (state.focus) setFocus(null);
}

export function setSelection(selection) {
  state.selection = selection; // {from, to} | null
  notify();
}

export function clearSelection() {
  if (state.selection) setSelection(null);
}

export function setImportOpen(open) {
  state.importOpen = !!open;
  notify();
}

export function setLoss(patch) {
  Object.assign(state.loss, patch);
  persist();
  notify();
}

export function lossA() {
  return state.loss.aByType[state.loss.type];
}

export function setLossA(a) {
  state.loss.aByType[state.loss.type] = a;
  persist();
  notify();
}

export function setCard(id) {
  state.card = id;
  notify();
}

export function setStage(stepId, n) {
  const stage = Math.max(0, Math.floor(Number(n) || 0));
  state.stage[stepId] = stage;
  // 推进到第 1 步及以后：打开推导次级窗口；回到起点：若窗口正展示该卡则关闭
  if (stage > 0) state.deriveWindow = { card: stepId };
  else if (state.deriveWindow?.card === stepId) state.deriveWindow = null;
  persist();
  notify();
}

export function closeDeriveWindow() {
  if (!state.deriveWindow) return;
  state.deriveWindow = null;
  notify();
}

export function setStatus(status) {
  state.status = status;
  notify();
}

export function clearStatus() {
  if (state.status) setStatus(null);
}

export function dismissHint(id) {
  state.hintsDismissed.add(id);
  saveHints(state.hintsDismissed);
  notify();
}

export function restoreHints() {
  state.hintsDismissed.clear();
  saveHints(state.hintsDismissed);
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

export function scopeValues(scope) {
  const rows = scope === 'all' ? state.rows : state.rows.filter((r) => r.group === scope);
  return rows.map((r) => r.value);
}

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
