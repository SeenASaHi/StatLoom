// deriveWindow.js — 推导次级窗口
// 分析规程把步骤推进后，推导过程在本浮动窗口展开（公式 / 解释 / 依据前提 / 当前数据实例 / 定位入口）。
// 窗口自带步进板（与流程内卡片同一状态）；可关闭（不影响已推进的阶段），Esc 关闭，回到起点板自动关闭。

import * as store from './../store.js';
import { buildCardSteps, stagePlates, PLATES_A, PLATES_B } from './formula.js';
import { h, clear } from './../util.js';

const CARD_TITLES = {
  'ssTotal-def': '总平方和 SS_T',
  decomp: '平方和分解：组内与组间',
};

let root = null;
let lastFocusSeq = -1;
const prevStages = { 'ssTotal-def': 0, decomp: 0 };

export function init(container) {
  root = container;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && store.state.deriveWindow && !store.state.card) {
      store.closeDeriveWindow(); // 知识库未开时，Esc 关闭推导窗口
    }
  });
}

export function render(state) {
  if (!root) return;
  const w = state.deriveWindow;

  if (!w) {
    root.hidden = true;
    clear(root);
    prevStages['ssTotal-def'] = 0;
    prevStages.decomp = 0;
    return;
  }

  root.hidden = false;
  clear(root);

  const fresh = (state.focusSeq ?? 0) !== lastFocusSeq;
  lastFocusSeq = state.focusSeq ?? 0;

  const stage = state.stage[w.card] ?? 0;
  const prev = prevStages[w.card] ?? 0;
  prevStages[w.card] = stage;

  // 窗口头：类型标签 + 标题 + 步进板 + 关闭
  const head = h('div', { class: 'dw-head' });
  head.append(h('span', { class: 'g-tag g-tag-derive' }, '推导窗口'));
  head.append(h('h3', null, CARD_TITLES[w.card] ?? w.card));
  head.append(stagePlates(state, w.card, w.card === 'ssTotal-def' ? PLATES_A : PLATES_B, stage));
  head.append(
    h('button', { class: 'drawer-close', title: '关闭窗口（Esc）', 'aria-label': '关闭推导窗口', onclick: () => store.closeDeriveWindow() }, '×')
  );
  root.append(head);

  const body = h('div', { class: 'dw-body' });
  if (!state.rows.length) {
    body.append(h('p', { class: 'empty-note' }, '没有数据，暂时没有可展示的推导实例。'));
  } else {
    const steps = buildCardSteps(state, w.card, prev, fresh);
    for (const s of steps) body.append(s);
    body.append(
      h('p', { class: 'f-note' }, '推导可以停留在任何一步；关闭窗口不会丢失已推进的阶段，回到「0 · 起点」可收起。')
    );
  }
  root.append(body);
}
