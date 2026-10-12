// e2e.mjs — 端到端交互验证：用 Chrome DevTools Protocol 驱动真实浏览器点击界面。
// 前置：先在 test/ 目录启动本地服务器（python -m http.server 8123 或 start.bat）。
// 运行：node tools/e2e.mjs

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_APP = 'http://localhost:8123/';
const PORT = 9223;

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
  console.error('无法访问 ' + URL_APP + '，请先在 test/ 目录启动服务器（python -m http.server 8123）。');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'statloom-e2e-'));
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
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:8123'));
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

  // ---------- 开始验证 ----------

  console.log('== 首屏渲染 ==');
  await waitFor(() => evalJS(`document.querySelectorAll('.specimen').length === 20`), { desc: '样本托盘 20 件' });
  check('样本托盘渲染 20 件', true);
  check('总均值 77.85', (await evalJS(tileValue('均值'))) === '77.85', await evalJS(tileValue('均值')));
  check('SS_T 3214.55', (await evalJS(tileValue('SS_T'))) === '3214.55', await evalJS(tileValue('SS_T')));
  check('SS_B 396.05', (await evalJS(tileValue('SS_B'))) === '396.05', await evalJS(tileValue('SS_B')));
  check('SS_W 2818.5', (await evalJS(tileValue('SS_W'))) === '2818.5', await evalJS(tileValue('SS_W')));
  check('分布图点 20 个', (await evalJS(`document.querySelectorAll('#panel-chart .dot-hit').length`)) === 20);

  console.log('== 校准步进板 ==');
  await evalJS(`document.querySelectorAll('#panel-formula .f-card')[0].querySelector('.stage-plate[data-stage="3"]').click()`);
  await sleep(200);
  const stepCount = await evalJS(`document.querySelectorAll('#panel-formula .f-step').length`);
  check('推进到第 3 步后出现推导步骤（>=3）', stepCount >= 3, `steps=${stepCount}`);
  check('步进板标记当前步', (await evalJS(`!!document.querySelector('#panel-formula .stage-plate.is-active[data-stage="3"]')`)) === true);
  await evalJS(`document.querySelectorAll('#panel-formula .f-card')[1].querySelector('.stage-plate[data-stage="3"]').click()`);
  await sleep(200);
  check('分解卡推进到第 3 步（合计 >=6）', (await evalJS(`document.querySelectorAll('#panel-formula .f-step').length`)) >= 6);
  await evalJS(`document.querySelectorAll('#panel-formula .f-card')[0].querySelector('.stage-plate[data-stage="0"]').click()`);
  await sleep(200);
  check('起点板收起步骤（第一卡回到 0）', (await evalJS(`document.querySelectorAll('#panel-formula .f-card')[0].querySelectorAll('.f-step').length`)) === 0);
  await evalJS(`document.querySelectorAll('#panel-formula .f-card')[0].querySelector('.stage-plate[data-stage="3"]').click()`);
  await sleep(200);

  console.log('== 公式项 → 数据（双向追踪第一向） ==');
  await evalJS(clickByText('#panel-formula .f-term', '− ȳ)²'));
  await sleep(150);
  check('偏差项聚焦：样本托盘 20 个偏差读数高亮', (await evalJS(`document.querySelectorAll('#specimen-tray .dev-cell.is-focus-soft').length`)) === 20);
  check('偏差项聚焦：分布图出现偏差连线', (await evalJS(`document.querySelectorAll('#panel-chart .dev-connector').length`)) === 20);

  console.log('== 数据 → 公式数值实例（双向追踪第二向） ==');
  await evalJS(`document.querySelector('.specimen[data-id="r05"]').click()`);
  await sleep(150);
  check('点击数据行后公式面板对应实例行高亮', (await evalJS(`!!document.querySelector('#panel-formula .f-inst-table tbody tr.is-focus')`)) === true);
  check('点击数据行后分布图对应点高亮', (await evalJS(`document.querySelectorAll('#panel-chart .dot.is-focus').length`)) >= 1);

  console.log('== 修改观测值（可选预测 → 应用 → 对照） ==');
  await evalJS(`(() => { const inp = document.querySelector('.specimen[data-id="r05"] .value-input'); inp.value = '95'; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(() => evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '可选预测'`), { desc: '预测提问出现' });
  check('修改前出现可选预测（可跳过）', (await evalJS(`!![...document.querySelectorAll('#guidance-bar button')].find(b => b.textContent.includes('跳过预测'))`)) === true);
  await evalJS(clickByText('#guidance-bar button', '↓ 变小'));
  await waitFor(() => evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '预测对照'`), { desc: '预测对照出现' });
  check('操作后出现预测对照卡', true);
  check('均值实时更新为 78.85', (await evalJS(tileValue('均值'))) === '78.85', await evalJS(tileValue('均值')));
  await evalJS(clickByText('#guidance-bar button', '关闭'));

  console.log('== 混合分组（保留对比视图） ==');
  await evalJS(`document.getElementById('btn-mix').click()`);
  await waitFor(() => evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '可选预测'`), { desc: '混合前预测提问' });
  await evalJS(clickByText('#guidance-bar button', '↓ 变小'));
  await sleep(200);
  check('混合后 SS_B = 0', (await evalJS(tileValue('SS_B'))) === '0', await evalJS(tileValue('SS_B')));
  check('保留 2 个混合前分组行（淡色对比）', (await evalJS(`document.querySelectorAll('.ghost-row').length`)) === 2);
  check('复核台分组块标记为混合前', (await evalJS(`!!document.querySelector('#panel-dock .stat-block.is-ghost')`)) === true);
  check('图表注明混合视图', (await evalJS(`!![...document.querySelectorAll('.chart-note')].find(n => n.textContent.includes('混合视图'))`)) === true);
  check('工具栏按钮变为还原分组', (await evalJS(`document.getElementById('btn-mix').textContent`)) === '还原分组');

  console.log('== 撤销 ==');
  await evalJS(`document.getElementById('btn-undo').click()`);
  await sleep(150);
  check('撤销后 SS_B 恢复 238.05', (await evalJS(tileValue('SS_B'))) === '238.05', await evalJS(tileValue('SS_B')));
  check('撤销后按钮回到混合这些组', (await evalJS(`document.getElementById('btn-mix').textContent`)) === '混合这些组');

  console.log('== 恢复原始数据 ==');
  await evalJS(`document.getElementById('btn-reset').click()`);
  await sleep(150);
  check('恢复后均值 77.85', (await evalJS(tileValue('均值'))) === '77.85', await evalJS(tileValue('均值')));
  check('恢复后 r05 值为 75', (await evalJS(`document.querySelector('.specimen[data-id="r05"] .value-input').value`)) === '75');

  console.log('== 损失函数画布 ==');
  check('损失曲线已绘制', (await evalJS(`!!document.querySelector('#panel-loss .loss-curve')`)) === true);
  await evalJS(
    `(() => { const s = document.querySelector('#panel-loss .loss-slider'); s.value = '60'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
  );
  await sleep(250);
  const lossAt60 = await evalJS(`document.querySelector('#panel-loss .loss-value-big')?.textContent`);
  check('滑动候选解后 L(a) 实时更新为 9587', lossAt60 === '9587', String(lossAt60));
  await evalJS(clickByText('#panel-loss button', '跳到最优解'));
  await sleep(250);
  check(
    '跳到最优解后损失已达最小',
    (await evalJS(`document.querySelector('#panel-loss .f-note')?.textContent.includes('已在最优解上')`)) === true
  );

  console.log('== 切换损失函数（可选预测） ==');
  await evalJS(clickByText('#panel-loss button', '绝对损失'));
  await waitFor(() => evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '可选预测'`), { desc: '切换损失前的预测提问' });
  await evalJS(clickByText('#guidance-bar button', '中位数'));
  await sleep(300);
  const optLabel = await evalJS(`document.querySelector('#panel-loss .loss-opt-label')?.textContent`);
  check('绝对损失下最优解为中位区间 [79, 80]', !!optLabel && optLabel.includes('[79, 80]'), String(optLabel));
  check('最优区间带宽已显示', (await evalJS(`!!document.querySelector('#panel-loss .opt-band')`)) === true);
  await evalJS(clickByText('#guidance-bar button', '关闭'));
  await evalJS(clickByText('#panel-loss button', '跳到最优解'));
  await sleep(250);
  check(
    '跳到区间中点后损失已达最小',
    (await evalJS(`document.querySelector('#panel-loss .f-note')?.textContent.includes('已在最优解上')`)) === true
  );

  console.log('== 知识卡片 ==');
  await evalJS(`document.querySelector('#panel-dock .book-btn').click()`);
  await sleep(250);
  check('点击 📖 打开知识卡抽屉', (await evalJS(`document.querySelector('#knowledge-drawer').classList.contains('open')`)) === true);
  check(
    '均值卡显示当前数据实例 77.85',
    (await evalJS(`document.querySelector('#knowledge-drawer .card-instance')?.textContent.includes('77.85')`)) === true
  );
  await evalJS(clickByText('#knowledge-drawer .card-links button', '中位数'));
  await sleep(200);
  const drawerTitle = await evalJS(`document.querySelector('#knowledge-drawer .drawer-head h3')?.textContent.trim()`);
  check('卡内跳转到中位数卡', drawerTitle === '中位数', String(drawerTitle));
  check(
    '中位数卡实例同步当前数据 79.5',
    (await evalJS(`document.querySelector('#knowledge-drawer .card-instance')?.textContent.includes('79.5')`)) === true
  );
  await evalJS(`document.querySelector('#knowledge-drawer .drawer-close').click()`);
  await sleep(200);
  check('抽屉可关闭', (await evalJS(`!document.querySelector('#knowledge-drawer').classList.contains('open')`)) === true);
  await evalJS(`document.querySelector('#panel-chart .chart-note .book-btn').click()`);
  await sleep(200);
  const title2 = await evalJS(`document.querySelector('#knowledge-drawer .drawer-head h3')?.textContent.trim()`);
  check('分布图的规则提示可打开 IQR 知识卡', title2 === 'IQR 规则提示', String(title2));
  check(
    'IQR 卡实例列出被标记观测 r01',
    (await evalJS(`document.querySelector('#knowledge-drawer .card-instance')?.textContent.includes('r01')`)) === true
  );
  await evalJS(`document.querySelector('#knowledge-drawer .drawer-close').click()`);
  await sleep(150);

  console.log('== 情境提示 ==');
  const hintCount = await evalJS(`document.querySelectorAll('.hint').length`);
  check('首屏出现情境提示（>=2）', hintCount >= 2, `hints=${hintCount}`);
  await evalJS(`document.querySelector('.hint .hint-close').click()`);
  await sleep(100);
  check('提示可关闭', (await evalJS(`document.querySelectorAll('.hint').length`)) === hintCount - 1);
  console.log('== 增删观测 ==');
  await evalJS(`document.querySelector('.tray-tools .btn').click()`);
  await waitFor(() => evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '可选预测'`), { desc: '新增观测前的预测提问' });
  await evalJS(clickByText('#guidance-bar button', '跳过预测'));
  await sleep(250);
  check('新增观测后托盘 21 件', (await evalJS(`document.querySelectorAll('.specimen').length`)) === 21);
  await evalJS(`document.getElementById('btn-undo').click()`);
  await sleep(250);
  check('撤销后回到 20 件', (await evalJS(`document.querySelectorAll('.specimen').length`)) === 20);

  console.log('== 调整分组 ==');
  await evalJS(
    `(() => { const sel = document.querySelector('.specimen[data-id="r11"] .group-select'); sel.value = '讲授式'; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
  );
  await waitFor(() => evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '可选预测'`), { desc: '移动分组前的预测提问' });
  await evalJS(clickByText('#guidance-bar button', '↓ 变小'));
  await sleep(250);
  const ssBAfterMove = await evalJS(tileValue('SS_B'));
  check('移动一条观测后 SS_B 实时变化', ssBAfterMove !== '396.05', String(ssBAfterMove));
  await evalJS(clickByText('#guidance-bar button', '关闭'));
  await evalJS(`document.getElementById('btn-undo').click()`);
  await sleep(250);
  check('撤销后 SS_B 恢复 396.05', (await evalJS(tileValue('SS_B'))) === '396.05', await evalJS(tileValue('SS_B')));

  console.log('== 复核门回退 ==');
  await evalJS(
    `(() => { const inp = document.querySelector('.specimen[data-id="r02"] .value-input'); inp.value = '70'; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
  );
  await waitFor(() => evalJS(`document.querySelector('#guidance-bar .g-tag')?.textContent === '可选预测'`), { desc: '回退用例的预测提问' });
  await evalJS(clickByText('#guidance-bar button', '↑ 变大'));
  await sleep(300);
  check(
    '复核门提供回退（回滚条件可见）',
    (await evalJS(`!![...document.querySelectorAll('#guidance-bar button')].find(b => b.textContent.trim() === '回退')`)) === true
  );
  await evalJS(clickByText('#guidance-bar button', '回退'));
  await sleep(300);
  check('回退后 r02 恢复 62', (await evalJS(`document.querySelector('.specimen[data-id="r02"] .value-input').value`)) === '62');

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
