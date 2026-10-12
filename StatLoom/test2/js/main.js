// main.js — 装配入口：稳定框架 + 任务视图布局 + 订阅分发
// 布局由状态中的任务视图决定（CSS grid-template-areas 重排，同一 DOM，切换不丢状态）；
// 视图属性在渲染前应用，面板测量宽度时即是可见状态。

import * as store from './store.js';
import { initTooltip, h, clear } from './util.js';
import { initWave } from './wave.js';
import * as guidance from './guidance.js';
import * as tray from './views/tray.js';
import * as chart from './views/chart.js';
import * as inspector from './views/inspector.js';
import * as dock from './views/dock.js';
import * as formula from './views/formula.js';
import * as deriveWindow from './views/deriveWindow.js';
import * as loss from './views/loss.js';
import * as drawer from './views/drawer.js';

initTooltip();
initWave(document.getElementById('wave-canvas'));

tray.init(document.getElementById('specimen-tray'));
chart.init(document.getElementById('panel-chart'));
inspector.init(document.getElementById('panel-inspector'));
dock.init(document.getElementById('panel-dock'), document.getElementById('panel-rails'));
formula.init(document.getElementById('panel-formula'));
deriveWindow.init(document.getElementById('derive-window'));
loss.init(document.getElementById('panel-loss'));
drawer.init(document.getElementById('knowledge-drawer'));

const mainEl = document.getElementById('lab-main');
const pathStrip = document.getElementById('path-strip');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnReset = document.getElementById('btn-reset');
const btnHints = document.getElementById('btn-hints');
const chkMixed = document.getElementById('chk-mixed');
const viewButtons = [...document.querySelectorAll('.view-switch .stage-plate')];

btnUndo.title = '撤销上一步数据操作';
btnRedo.title = '重做已撤销的操作';
btnReset.title = '清空数据集，回到导入门（可撤销）';

btnUndo.addEventListener('click', () => store.undo());
btnRedo.addEventListener('click', () => store.redo());
btnReset.addEventListener('click', () => store.resetAll());
btnHints.addEventListener('click', () => store.restoreHints());
chkMixed.addEventListener('change', () => store.applyDataOp({ type: 'setMixed', value: chkMixed.checked }));
for (const b of viewButtons) b.addEventListener('click', () => store.setView(b.dataset.view));

store.subscribe((state) => {
  // 布局优先：先切视图属性，视图测量宽度时才是可见的
  mainEl.dataset.view = state.view;
  for (const b of viewButtons) {
    const active = b.dataset.view === state.view;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  }
  renderPath(state);

  btnUndo.disabled = !store.canUndo();
  btnRedo.disabled = !store.canRedo();
  chkMixed.checked = state.mixed;

  tray.render(state);
  chart.render(state);
  inspector.render(state);
  dock.render(state);
  formula.render(state);
  deriveWindow.render(state);
  loss.render(state);
  drawer.render(state);
  guidance.render(state);
});

// 探索路径条：返回到发起追踪的对象
function renderPath(state) {
  clear(pathStrip);
  if (!state.path.length) {
    pathStrip.hidden = true;
    return;
  }
  pathStrip.hidden = false;
  pathStrip.append(h('span', { class: 'micro' }, '探索路径'));
  state.path.forEach((p, i) => {
    if (i) pathStrip.append(h('span', { class: 'path-sep', 'aria-hidden': 'true' }, '›'));
    pathStrip.append(
      h('button', { class: 'path-chip', title: '返回到这个对象', onclick: () => store.setFocus(p.focus) }, p.label)
    );
  });
  pathStrip.querySelector('.path-chip:last-of-type')?.scrollIntoView({ block: 'nearest', inline: 'end' });
}

// 调试与端到端测试用的钩子（不影响界面行为）
window.statloom = { store };
