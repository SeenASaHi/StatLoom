// main.js — 装配入口：订阅 store，把状态变化分发给各视图。
// 区域：顶栏 shell / 分析台（观测窗 + 复核台）/ 样本托盘 / 分析规程 / 处置台。

import * as store from './store.js';
import { initTooltip } from './util.js';
import * as guidance from './guidance.js';
import * as tray from './views/tray.js';
import * as chart from './views/chart.js';
import * as dock from './views/dock.js';
import * as formula from './views/formula.js';
import * as loss from './views/loss.js';
import * as drawer from './views/drawer.js';

initTooltip();

tray.init(document.getElementById('specimen-tray'));
chart.init(document.getElementById('panel-chart'));
dock.init(document.getElementById('panel-dock'), document.getElementById('panel-rails'));
formula.init(document.getElementById('panel-formula'));
loss.init(document.getElementById('panel-loss'));
drawer.init(document.getElementById('knowledge-drawer'));

const btnMix = document.getElementById('btn-mix');
const btnUndo = document.getElementById('btn-undo');
const btnReset = document.getElementById('btn-reset');
const chkPredict = document.getElementById('chk-predict');
const btnHints = document.getElementById('btn-hints');

btnMix.title = '把两组观测合并成一组，观察分布与读数的变化';
btnUndo.title = '撤销上一步数据操作';
btnReset.title = '恢复到最初的内置数据集（可撤销）';

btnMix.addEventListener('click', () => guidance.toggleMix());
btnUndo.addEventListener('click', () => store.undo());
btnReset.addEventListener('click', () => store.resetData());
chkPredict.addEventListener('change', () => store.setPredictMode(chkPredict.checked));
btnHints.addEventListener('click', () => store.restoreHints());

store.subscribe((state) => {
  btnMix.textContent = state.mixed ? '还原分组' : '混合这些组';
  btnUndo.disabled = !store.canUndo();
  chkPredict.checked = state.predict.mode;

  tray.render(state);
  chart.render(state);
  dock.render(state);
  formula.render(state);
  loss.render(state);
  drawer.render(state);
  guidance.render(state);
});

// 调试与端到端测试用的钩子（不影响界面行为）
window.statloom = { store };
