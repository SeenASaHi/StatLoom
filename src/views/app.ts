// 装配：Store + 五个视图（画布/读数/检查器/关系图/环境层）+ 导轨 + 导入导出面板 + 全局键盘。
// 视图以 (snapshot.effective, ui) 为唯一输入；渲染后恢复键盘焦点；不变量 C 由"同一快照渲染"保证。

import 'katex/dist/katex.min.css';
import '../styles/tokens.css';
import '../styles/app.css';

import { parseCsv } from '../csv';
import { emptySource } from '../fixtures';
import { serializeSource } from '../kernel/schema';
import { Store, type StoreSnapshot } from '../state/store';
import { mountAmbient } from './ambient';
import { mountCanvasView } from './canvas-view';
import { mountInspector } from './inspector-view';
import { mountReadings } from './readings';
import { mountRelation } from './relation-view';
import { RepRegistry } from './reps';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`缺少元素 #${id}`);
  return el as T;
}

const store = new Store(emptySource());
const reps = new RepRegistry();

const canvasView = mountCanvasView(must('canvas-mount'), store, reps, () => openOverlay('import'));
const readingsView = mountReadings(must('readings-mount'), store, reps);
const inspectorView = mountInspector(must('inspector-mount'), store, reps);
const relationView = mountRelation(must('relation-mount'), store, reps);
const ambient = mountAmbient(must<HTMLCanvasElement>('bg'));

const btnUndo = must<HTMLButtonElement>('btnUndo');
const btnRedo = must<HTMLButtonElement>('btnRedo');
const btnSquares = must<HTMLButtonElement>('btnSquares');
const btnVisual = must<HTMLButtonElement>('btnVisual');
const noticeEl = must('notice');
const noticeText = must('notice-text');

// ---------- 导轨 ----------
must<HTMLButtonElement>('btnBench').addEventListener('click', () => store.dispatch({ type: 'loadBenchmark' }));
must<HTMLButtonElement>('btnImport').addEventListener('click', () => openOverlay('import'));
must<HTMLButtonElement>('btnExport').addEventListener('click', () => openOverlay('export'));
must<HTMLButtonElement>('btnReset').addEventListener('click', () => store.dispatch({ type: 'reset' }));
btnUndo.addEventListener('click', () => store.dispatch({ type: 'undo' }));
btnRedo.addEventListener('click', () => store.dispatch({ type: 'redo' }));
btnSquares.addEventListener('click', () => store.setUi({ showSquares: !store.getSnapshot().ui.showSquares }));
btnVisual.addEventListener('click', () => store.setUi({ showVisualEdges: !store.getSnapshot().ui.showVisualEdges }));
must<HTMLButtonElement>('btnAddGroup').addEventListener('click', () => {
  const name = window.prompt('新组名', `组 ${store.getSnapshot().source.dataset.groups.length + 1}`);
  if (name !== null) store.dispatch({ type: 'addGroup', name });
});

// ---------- 导入 / 导出面板 ----------
const overlay = must('overlay');
const ioTitle = must('ioTitle');
const ioText = must<HTMLTextAreaElement>('ioText');
const ioErrors = must('ioErrors');
const ioPreview = must('ioPreview');
const ioCsv = must<HTMLButtonElement>('ioCsv');
const ioSnapshot = must<HTMLButtonElement>('ioSnapshot');
const ioCopy = must<HTMLButtonElement>('ioCopy');
let csvPending: string | null = null;
let ioMode: 'import' | 'export' = 'import';

function openOverlay(mode: 'import' | 'export'): void {
  ioMode = mode;
  csvPending = null;
  overlay.classList.add('open');
  if (mode === 'import') {
    ioTitle.innerHTML = '粘贴导入<em>Import · CSV 或快照 JSON</em>';
    ioText.value = '';
    ioText.readOnly = false;
    ioText.placeholder = 'group,value\nA,1\nB,2\n…（CSV 两列、必须有表头；或直接粘贴快照 JSON）';
    ioCsv.textContent = '检查并载入 CSV';
    ioCsv.hidden = false;
    ioSnapshot.hidden = false;
    ioCopy.hidden = true;
    ioErrors.textContent = '';
    ioPreview.textContent = '';
  } else {
    ioTitle.innerHTML = '导出快照<em>Export · SourceState JSON</em>';
    ioText.value = serializeSource(store.getSnapshot().source);
    ioText.readOnly = true;
    ioCsv.hidden = true;
    ioSnapshot.hidden = true;
    ioCopy.hidden = false;
    ioErrors.textContent = '';
    ioPreview.textContent = 'Snapshots 只含源状态（组、观测、idCounter）；派生结果由内核重建，不入快照。';
  }
  ioText.focus();
}

function closeOverlay(): void {
  overlay.classList.remove('open');
}

must<HTMLButtonElement>('ioClose').addEventListener('click', closeOverlay);
overlay.addEventListener('click', (ev) => {
  if (ev.target === overlay) closeOverlay();
});
ioText.addEventListener('input', () => {
  if (ioMode === 'import') {
    csvPending = null;
    ioCsv.textContent = '检查并载入 CSV';
    ioPreview.textContent = '';
  }
});
ioCsv.addEventListener('click', () => {
  if (csvPending !== null) {
    const res = store.dispatch({ type: 'importCsv', text: csvPending });
    if (res.ok) {
      closeOverlay();
      return;
    }
    ioErrors.textContent = res.reason;
    csvPending = null;
    ioCsv.textContent = '检查并载入 CSV';
    return;
  }
  const parsed = parseCsv(ioText.value);
  if (!parsed.ok) {
    ioErrors.textContent = parsed.errors.join('\n');
    return;
  }
  ioErrors.textContent = '';
  const head = parsed.rows
    .slice(0, 5)
    .map((r) => `${r.group} , ${r.value}`)
    .join('\n');
  ioPreview.textContent = `预检通过：${parsed.rows.length} 行 · ${parsed.groups.length} 组（整批提交，可撤销）\n前几行：\n${head}${parsed.rows.length > 5 ? '\n…' : ''}`;
  csvPending = ioText.value;
  ioCsv.textContent = `确认载入 ${parsed.rows.length} 行`;
});
ioSnapshot.addEventListener('click', () => {
  const res = store.dispatch({ type: 'importSnapshot', text: ioText.value });
  if (res.ok) {
    closeOverlay();
    return;
  }
  ioErrors.textContent = res.reason;
});
ioCopy.addEventListener('click', () => {
  navigator.clipboard
    .writeText(ioText.value)
    .then(() => {
      ioPreview.textContent = '已复制到剪贴板。';
    })
    .catch(() => {
      ioText.select();
      ioPreview.textContent = '剪贴板不可用：文本已全选，请手动复制。';
    });
});

// ---------- 全局键盘 ----------
window.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && !ev.shiftKey && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    store.dispatch({ type: 'undo' });
    return;
  }
  if (ev.ctrlKey && (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z'))) {
    ev.preventDefault();
    store.dispatch({ type: 'redo' });
    return;
  }
  if (ev.key === 'Escape') {
    const snap = store.getSnapshot();
    if (snap.ui.preview !== null) store.cancelPreview();
    if (overlay.classList.contains('open')) closeOverlay();
  }
});

// ---------- 渲染管线 ----------
let lastSource: unknown = null;

function groupIdOfSelection(snap: StoreSnapshot): string | null {
  const id = snap.ui.selectedId;
  if (id === null) return null;
  const d = snap.source.dataset;
  if (id.startsWith('obs-')) return d.observations.find((o) => o.id === id)?.groupId ?? null;
  if (id.startsWith('grp-')) return id;
  for (const pre of ['mean:', 'count:', 'gdev:', 'gdevsq:']) {
    if (id.startsWith(pre)) return id.slice(pre.length);
  }
  if (id.startsWith('dev:') || id.startsWith('devsq:')) {
    const oid = id.slice(id.indexOf(':') + 1);
    return d.observations.find((o) => o.id === oid)?.groupId ?? null;
  }
  return null;
}

function renderAll(snap: StoreSnapshot): void {
  const active = document.activeElement;
  // 注意：SVG 元素不是 HTMLElement——焦点捕捉与恢复都要覆盖 SVGElement
  const focusKey = active instanceof SVGElement || active instanceof HTMLElement ? active.getAttribute('data-key') : null;

  canvasView.render(snap);
  readingsView.render(snap);
  inspectorView.render(snap);
  relationView.render(snap);

  btnUndo.disabled = !snap.canUndo || snap.ui.preview !== null;
  btnRedo.disabled = !snap.canRedo || snap.ui.preview !== null;
  btnSquares.setAttribute('aria-pressed', String(snap.ui.showSquares));
  btnSquares.textContent = snap.ui.showSquares ? '平方块：开' : '平方块：关';
  btnVisual.setAttribute('aria-pressed', String(snap.ui.showVisualEdges));
  btnVisual.textContent = snap.ui.showVisualEdges ? '视觉映射边：开' : '视觉映射边：关';

  const notice = snap.ui.notice;
  noticeEl.className = `notice kind-${notice?.kind ?? 'info'}`;
  noticeText.textContent =
    notice?.text ??
    (snap.source.dataset.observations.length === 0 ? '空工作台：载入基准案例，或粘贴导入。' : '就绪。');

  if (focusKey !== null) {
    const el = document.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if ((el instanceof SVGElement || el instanceof HTMLElement) && el !== document.activeElement) {
      el.focus({ preventScroll: true });
    }
  }

  if (snap.source !== lastSource) {
    if (lastSource !== null) ambient.pulse();
    lastSource = snap.source;
  }
  ambient.update(snap.source, groupIdOfSelection(snap));
}

store.subscribe(renderAll);

// 诊断句柄（e2e 与调试用；不属于应用状态的一部分）
(window as unknown as { __store?: Store }).__store = store;
