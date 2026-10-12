// e2e.mjs — 原型二端到端验证
// 流程：空态 → 导入门（校验与提交）→ 编辑/撤销/重做 → 框选选区 → 视图切换与状态保留
//       → 校准步进板 → 双向追踪 → 损失配置保留与比较 → 知识卡 → 清空与恢复
// 前置：在 test2/ 目录启动本地服务器（python -m http.server 8124 或 start.bat）。运行：node tools/e2e.mjs

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_APP = 'http://localhost:8124/';
const PORT = 9223;
const IMPORT_TEXT = ['组,成绩', '甲,10', '甲,20', '乙,30', '乙,40', '丙,abc'].join('\n');

let passes = 0;
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passes++;
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.error('  FAIL  ' + name + (extra ? '  →  ' + extra : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 8000, interval = 120, desc = 'condition' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* 重试 */
    }
    await sleep(interval);
  }
  throw new Error('等待超时：' + desc);
}

// ---------- 定位浏览器 ----------

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error('未找到 Chrome 或 Edge 浏览器。');
  process.exit(2);
}

try {
  const r = await fetch(URL_APP);
  if (!r.ok) throw new Error(String(r.status));
} catch {
  console.error('无法访问 ' + URL_APP + '，请先在 test2/ 目录启动服务器（python -m http.server 8124）。');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'statloom-e2e2-'));
const chrome = spawn(
  exe,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    URL_APP,
  ],
  { stdio: 'ignore' }
);

let ws;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok, { desc: '调试端口就绪' });

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:8124'));
  if (!page) throw new Error('未找到应用页面 target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });

  let seq = 1;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'unknown');
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = seq++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('页面脚本异常：' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    }
    return r.result?.value;
  };

  await send('Runtime.enable');

  // ---------- 公共查询片段 ----------

  const tileValue = (label) =>
    `[...document.querySelectorAll('#panel-dock .stat-tile')].find(t => t.querySelector('.tile-label')?.textContent.includes('${label}'))?.querySelector('.tile-value').textContent`;

  const clickByText = (selector, text) =>
    `(() => { const el = [...document.querySelectorAll('${selector}')].find(e => e.textContent.trim().includes('${text}')); if (!el) return false; el.click(); return true; })()`;

  const setTextarea = (sel, text) =>
    `(() => { const el = document.querySelector('${sel}'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;

  const setValue = (id, v) =>
    `(() => { const inp = document.querySelector('.specimen[data-id="${id}"] .value-input'); inp.value = '${v}'; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;

  // 由坐标轴刻度反推某个数值在页面中的 clientX（供框选指针事件使用）
  const xOfValue = (value) => `(() => {
  const svg = document.querySelector('#panel-chart .chart-svg');
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const scale = rect.width / vb.width;
  const ticks = [...svg.querySelectorAll('.axis-label')].map(t => ({ v: parseFloat(t.textContent), x: parseFloat(t.getAttribute('x')) })).filter(t => Number.isFinite(t.v)).sort((a, b) => a.v - b.v);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const x = lo.x + ((${value} - lo.v) / (hi.v - lo.v)) * (hi.x - lo.x);
  return rect.left + x * scale;
})()`;

  // ---------- 开始验证 ----------

  console.log('== 空态启动 ==');
  await waitFor(() => evalJS(`!!document.querySelector('.gate-panel')`), { desc: '空态导入门' });
  check('空态：导入门默认打开', true);
  check('空态：默认落在托盘视图', (await evalJS(`document.querySelector('.stage-plate[data-view="tray"]').classList.contains('is-active')`)) === true);
  check('空态：无样本', (await evalJS(`document.querySelectorAll('.specimen').length`)) === 0);
  check('空态：观测窗指向数据入口', (await evalJS(`!!document.querySelector('#panel-chart .empty-state button')`)) === true);
  check('阈值未达：提交按钮禁用', (await evalJS(`document.querySelector('.gate-commit').disabled`)) === true);

  console.log('== 导入门：校验与提交 ==');
  await evalJS(setTextarea('.gate-text', IMPORT_TEXT));
  await sleep(150);
  const gateCount = await evalJS(`document.querySelector('.gate-count').textContent`);
  check('预览：有效 4 条 · 2 组', gateCount.includes('有效 4 条') && gateCount.includes('2 组'), String(gateCount));
  check('表头被识别', (await evalJS(`!![...document.querySelectorAll('.gate-meta')].find(e => e.textContent.includes('组'))`)) === true);
  check('无效行按行号报告', (await evalJS(`document.querySelector('.gate-invalid-row')?.textContent.includes('第 6 行')`)) === true);
  await evalJS(`(() => { const el = document.querySelector('.gate-name'); el.value = '测试数据集'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  check('达到阈值后提交可用', (await evalJS(`document.querySelector('.gate-commit').disabled`)) === false);
  await evalJS(`document.querySelector('.gate-commit').click()`);
  await waitFor(() => evalJS(`document.querySelectorAll('.specimen').length === 4`), { desc: '导入后 4 件样本' });
  check('导入后托盘 4 件', true);
  check('导入门关闭', (await evalJS(`!document.querySelector('.gate-panel')`)) === true);
  check('状态反馈出现（可撤销）', (await evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '状态'`)) === true);
  check('均值 25', (await evalJS(tileValue('均值'))) === '25', await evalJS(tileValue('均值')));
  check('SS_T 500', (await evalJS(tileValue('SS_T'))) === '500', await evalJS(tileValue('SS_T')));
  check('SS_B 400', (await evalJS(tileValue('SS_B'))) === '400', await evalJS(tileValue('SS_B')));
  check('SS_W 100', (await evalJS(tileValue('SS_W'))) === '100', await evalJS(tileValue('SS_W')));
  check('溯源胶囊显示数据集名', (await evalJS(`document.querySelector('.capsule').textContent.includes('测试数据集')`)) === true);
  await evalJS(clickByText('#guidance-bar button', '关闭'));

  console.log('== 编辑 / 撤销 / 重做 ==');
  await evalJS(setValue('r01', '50'));
  await waitFor(() => evalJS(`${tileValue('均值')} === '35'`), { desc: '编辑后均值 35' });
  check('编辑 r01=50 后均值 35', true);
  await evalJS(`document.getElementById('btn-undo').click()`);
  await sleep(200);
  check('撤销后均值 25', (await evalJS(tileValue('均值'))) === '25', await evalJS(tileValue('均值')));
  await evalJS(`document.getElementById('btn-redo').click()`);
  await sleep(200);
  check('重做后均值 35', (await evalJS(tileValue('均值'))) === '35', await evalJS(tileValue('均值')));
  await evalJS(`document.getElementById('btn-undo').click()`);
  await sleep(200);
  check('再次撤销回到 25', (await evalJS(tileValue('均值'))) === '25');
  await evalJS(clickByText('#guidance-bar button', '关闭'));

  console.log('== 框选选区 ==');
  const x1 = await evalJS(xOfValue(24));
  const x2 = await evalJS(xOfValue(41));
  const yMid = await evalJS(`(() => { const r = document.querySelector('#panel-chart .chart-svg').getBoundingClientRect(); return r.top + r.height / 2; })()`);
  await evalJS(`(() => { const svg = document.querySelector('#panel-chart .chart-svg'); svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${x1}, clientY: ${yMid}, bubbles: true })); return true; })()`);
  await sleep(80);
  await evalJS(`window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${x2}, clientY: ${yMid}, bubbles: true })); true`);
  await sleep(80);
  await evalJS(`window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${x2}, clientY: ${yMid}, bubbles: true })); true`);
  await waitFor(() => evalJS(`!!document.querySelector('#panel-chart .select-band')`), { desc: '选区带出现' });
  check('框选后出现选区带', true);
  const selTitle = await evalJS(`document.querySelector('#panel-inspector .insp-selection .insp-title')?.textContent`);
  check('检查器：选区 2 件（30、40）', !!selTitle && selTitle.includes('2 件'), String(selTitle));
  check('托盘联动：2 件样本标出', (await evalJS(`document.querySelectorAll('.specimen.is-selected').length`)) === 2);
  check('观测窗联动：2 个点标出', (await evalJS(`document.querySelectorAll('#panel-chart .dot.is-selected').length`)) === 2);
  await evalJS(clickByText('#panel-inspector button', '清除选区'));
  await sleep(200);
  check('清除选区生效', (await evalJS(`!document.querySelector('#panel-chart .select-band')`)) === true);

  console.log('== 视图切换与状态保留 ==');
  await evalJS(`document.querySelector('.specimen[data-id="r02"]').click()`);
  await sleep(150);
  check('选中 r02', (await evalJS(`document.querySelectorAll('.specimen.is-focus').length`)) === 1);
  await evalJS(`document.querySelector('.stage-plate[data-view="derive"]').click()`);
  await sleep(300);
  check('切到推导视图', (await evalJS(`document.getElementById('lab-main').dataset.view`)) === 'derive');
  check('观测窗在推导视图隐藏', (await evalJS(`getComputedStyle(document.querySelector('.instrument')).display === 'none'`)) === true);
  check('焦点对象在实例表中保留', (await evalJS(`!!document.querySelector('#panel-formula .f-inst-table tbody tr.is-focus')`)) === true);
  check('探索路径条记录对象', (await evalJS(`[...document.querySelectorAll('.path-chip')].some(c => c.textContent === 'r02')`)) === true);

  console.log('== 托盘视图（与数据/推导/损失平级） ==');
  await evalJS(`document.querySelector('.stage-plate[data-view="tray"]').click()`);
  await sleep(250);
  check('切到托盘视图', (await evalJS(`document.getElementById('lab-main').dataset.view`)) === 'tray');
  check('托盘可见、观测窗隐藏', (await evalJS(`getComputedStyle(document.querySelector('.tray-pane')).display !== 'none' && getComputedStyle(document.querySelector('.instrument')).display === 'none'`)) === true);
  check('检查器在托盘视图保留', (await evalJS(`getComputedStyle(document.querySelector('.inspector-pane')).display !== 'none'`)) === true);
  await evalJS(`document.querySelector('.stage-plate[data-view="derive"]').click()`);
  await sleep(200);

  console.log('== 校准步进板与推导窗口 ==');
  await evalJS(`document.querySelectorAll('#panel-formula .f-card')[0].querySelector('.stage-plate[data-stage="3"]').click()`);
  await sleep(250);
  check('推进到第 3 步：推导窗口打开', (await evalJS(`!document.querySelector('#derive-window').hidden`)) === true);
  check('推导窗口展示 3 个步骤', (await evalJS(`document.querySelectorAll('#derive-window .f-step').length`)) === 3, String(await evalJS(`document.querySelectorAll('#derive-window .f-step').length`)));
  check('流程内卡片不再内联步骤', (await evalJS(`document.querySelectorAll('#panel-formula .f-step').length`)) === 0);
  check('关系类型标签存在', (await evalJS(`!!document.querySelector('#panel-formula .rel-tag')`)) === true);
  await evalJS(`document.querySelectorAll('#panel-formula .f-card')[1].querySelector('.stage-plate[data-stage="2"]').click()`);
  await sleep(250);
  check('切换卡片：窗口标题变为分解卡', (await evalJS(`document.querySelector('#derive-window .dw-head h3')?.textContent.includes('分解')`)) === true);
  await evalJS(`document.querySelector('#derive-window .dw-head .drawer-close').click()`);
  await sleep(200);
  check('推导窗口可关闭', (await evalJS(`document.querySelector('#derive-window').hidden`)) === true);
  await evalJS(`document.querySelectorAll('#panel-formula .f-card')[0].querySelector('.stage-plate[data-stage="0"]').click()`);
  await sleep(200);
  check('回到起点板不重开窗口', (await evalJS(`document.querySelector('#derive-window').hidden`)) === true);

  console.log('== 双向追踪 ==');
  await evalJS(clickByText('#panel-formula .f-term', '− ȳ)²'));
  await sleep(150);
  await evalJS(`document.querySelector('.stage-plate[data-view="data"]').click()`);
  await sleep(300);
  check('公式项聚焦：托盘 4 个偏差读数高亮', (await evalJS(`document.querySelectorAll('#specimen-tray .dev-cell.is-focus-soft').length`)) === 4);
  check('公式项聚焦：观测窗出现偏差连线', (await evalJS(`document.querySelectorAll('#panel-chart .dev-connector').length`)) === 4);
  await evalJS(`document.querySelector('.specimen[data-id="r03"]').click()`);
  await sleep(200);
  check('检查器显示样本 r03 与动作集', (await evalJS(`document.querySelector('#panel-inspector').textContent.includes('样本 r03') && !!document.querySelector('#panel-inspector .insp-actions')`)) === true);
  await evalJS(`document.querySelector('.stage-plate[data-view="derive"]').click()`);
  await sleep(300);
  check('实例行 r03 高亮', (await evalJS(`document.querySelector('#panel-formula .f-inst-table tbody tr.is-focus td')?.textContent`)) === 'r03');

  console.log('== 损失配置保留与比较 ==');
  await evalJS(`document.querySelector('.stage-plate[data-view="loss"]').click()`);
  await sleep(300);
  check('切到损失视图', (await evalJS(`document.getElementById('lab-main').dataset.view`)) === 'loss');
  await evalJS(`(() => { const s = document.querySelector('#panel-loss .loss-slider'); s.value = '30'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  check('平方损失 L(30) = 600', (await evalJS(`document.querySelector('#panel-loss .loss-value-big')?.textContent`)) === '600', await evalJS(`document.querySelector('#panel-loss .loss-value-big')?.textContent`));
  await evalJS(clickByText('#panel-loss button', '绝对损失'));
  await sleep(300);
  check('切目标后恢复该目标自己的 a=25', (await evalJS(`document.querySelector('#panel-loss .loss-slider').value`)) === '25', await evalJS(`document.querySelector('#panel-loss .loss-slider').value`));
  check('对照行显示另一目标损失（平方 L(25)=500）', (await evalJS(`!![...document.querySelectorAll('#panel-loss .loss-tile')].find(t => t.textContent.includes('对照') && t.textContent.includes('平方损失 L(a) = 500'))`)) === true);
  await evalJS(clickByText('#panel-loss button', '平方损失'));
  await sleep(300);
  check('切回后原配置 a=30 保留', (await evalJS(`document.querySelector('#panel-loss .loss-slider').value`)) === '30', await evalJS(`document.querySelector('#panel-loss .loss-slider').value`));

  console.log('== 知识库窗口 ==');
  await evalJS(`document.querySelector('.stage-plate[data-view="derive"]').click()`);
  await sleep(250);
  await evalJS(`document.querySelector('#panel-dock .book-btn').click()`);
  await sleep(250);
  check('打开知识库窗口', (await evalJS(`document.querySelector('#knowledge-drawer').classList.contains('open')`)) === true);
  check('目录收录 8 张卡', (await evalJS(`document.querySelectorAll('#knowledge-drawer .kb-item').length`)) === 8);
  check('锚点定位到均值卡', (await evalJS(`document.querySelector('#knowledge-drawer .kb-title')?.textContent.includes('均值')`)) === true);
  check('均值卡实例显示 25', (await evalJS(`document.querySelector('#knowledge-drawer .card-instance')?.textContent.includes('25')`)) === true);
  await evalJS(clickByText('#knowledge-drawer .kb-item', '中位数'));
  await sleep(200);
  check('目录可自由切换到中位数卡', (await evalJS(`document.querySelector('#knowledge-drawer .kb-title')?.textContent === '中位数'`)) === true);
  await evalJS(`document.querySelector('#knowledge-drawer .drawer-close').click()`);
  await sleep(200);
  check('知识库可关闭', (await evalJS(`!document.querySelector('#knowledge-drawer').classList.contains('open')`)) === true);

  console.log('== 点阵背景与仪器面 ==');
  check('点阵波浪画布存在', (await evalJS(`!!document.querySelector('#wave-canvas')`)) === true);
  check('顶栏为炭黑仪器面（深底浅字）', (await evalJS(`getComputedStyle(document.querySelector('.shell')).getPropertyValue('--ink').trim()`)) === '#eef2ef');
  check('底部提示栏同族深底', (await evalJS(`getComputedStyle(document.querySelector('.guidance-bar')).getPropertyValue('--ink').trim()`)) === '#eef2ef');

  console.log('== 情境提示 ==');
  const hintCount = await evalJS(`document.querySelectorAll('.hint').length`);
  check('情境提示存在（>=2）', hintCount >= 2, `hints=${hintCount}`);
  await evalJS(`document.querySelector('.hint .hint-close').click()`);
  await sleep(150);
  check('提示可关闭', (await evalJS(`document.querySelectorAll('.hint').length`)) === hintCount - 1);

  console.log('== 清空与恢复 ==');
  await evalJS(`document.getElementById('btn-reset').click()`);
  await sleep(300);
  check('清空后导入门重开', (await evalJS(`!!document.querySelector('.gate-panel')`)) === true);
  check('清空后无样本', (await evalJS(`document.querySelectorAll('.specimen').length`)) === 0);
  await evalJS(`document.getElementById('btn-undo').click()`);
  await sleep(300);
  check('撤销清空后 4 件样本恢复', (await evalJS(`document.querySelectorAll('.specimen').length`)) === 4);
  check('恢复后均值回到 25', (await evalJS(tileValue('均值'))) === '25', await evalJS(tileValue('均值')));
  await evalJS(clickByText('#guidance-bar button', '关闭'));

  check('全程无页面脚本异常', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  failures++;
  console.error('\nE2E 运行出错：' + err.message);
} finally {
  try {
    ws?.close();
  } catch { /* 忽略 */ }
  chrome.kill();
  await sleep(400);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { /* 忽略 */ }
}

console.log('');
console.log(`结果：${passes} 通过，${failures} 失败`);
process.exit(failures ? 1 : 0);
