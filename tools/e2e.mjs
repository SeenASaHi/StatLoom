// e2e.mjs — 端到端验证：CDP 驱动本机 Chrome/Edge。前置：test3 目录运行 `npm run dev`（5173）。
// 覆盖：载入基准 → 拖动同帧 → 撤销/重做 → 预览取消 → 关系图联动 → 键盘路径 → 空组边界 → reduced-motion → 窄视口。
// 定位声明：内核测试证明数学正确；本脚本证明浏览器中的关键路径可执行，不证明全部可访问性。

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_APP = 'http://localhost:5173/';
const PORT = 9223;

let passes = 0;
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passes += 1;
    console.log('  PASS  ' + name);
  } else {
    failures += 1;
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
      /* retry */
    }
    await sleep(interval);
  }
  throw new Error('等待超时：' + desc);
}

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
  console.error(`无法访问 ${URL_APP}，请先在 test3/ 运行 npm run dev。`);
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
    '--window-size=1440,900', // 固定桌面视口（窄视口在步骤 11 单独覆盖）
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    URL_APP,
  ],
  { stdio: 'ignore' },
);

let ws;
let exitCode = 0;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok, { desc: '调试端口就绪' });
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'));
  if (!page) throw new Error('未找到应用页面 target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });

  let seq = 1;
  const pending = new Map();
  const pageErrors = [];
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params?.exceptionDetails?.exception?.description ?? JSON.stringify(m.params?.exceptionDetails ?? {}));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      consoleErrors.push((m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
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

  const text = (selector) => evalJS(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const clickSel = (selector) =>
    evalJS(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()`);
  const rectOf = (selector) =>
    evalJS(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  const mouse = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
  const membership = async (tag) => {
    const m = await evalJS(
      `window.__store.getSnapshot().source.dataset.observations.map(o => o.id + '→' + o.groupId + '=' + o.value).join(' ')`,
    );
    console.log(`  [probe ${tag}] ${m}`);
  };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await waitFor(() => evalJS(`document.querySelector('[data-key="row:sst"] .val') !== null || document.querySelector('.empty-state') !== null`), {
    desc: '首屏挂载',
  });

  // ---------- 1. 页面无异常 ----------
  check('页面加载无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('页面无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('空态：画布窗口显示空工作台', (await text('.empty-state .big')) === '空工作台');
  check('空态：SS_total 显示 —（不显示 0）', (await text('[data-key="row:sst"] .val')) === '—');

  // ---------- 2. 载入基准（验收用例 A） ----------
  await clickSel('#btnBench');
  await waitFor(() => evalJS(`document.querySelectorAll('.pt').length === 6`), { desc: '6 个数据点' });
  check('载入基准：6 个数据点渲染', true);
  check('读数 SS_total = 17.50', (await text('[data-key="row:sst"] .val')) === '17.50');
  check('读数 SS_between = 13.50', (await text('[data-key="row:ssb"] .val')) === '13.50');
  check('读数 SS_within = 4.00', (await text('[data-key="row:ssw"] .val')) === '4.00');
  check('恒等式残差 0.00', (await text('[data-key="row:identity"] .val')) === '0.00');
  check('关系图渲染节点（含 sst / con:identity）', (await evalJS(`document.querySelector('[data-key="rel:sst"]') !== null && document.querySelector('[data-key="rel:con:identity"]') !== null`)) === true);
  check('分组点折叠（默认折叠组存在）', (await evalJS(`document.querySelector('[data-key="rel:fold:deviation"]') !== null`)) === true);

  // ---------- 3. 拖动：预览 → 提交（同帧读数更新） ----------
  await sleep(1100); // 等入场动效（.win 800ms 位移）结束，避免坐标漂移
  const p1 = await rectOf('[data-obs="obs-1"]');
  await mouse('mousePressed', p1.x, p1.y);
  await mouse('mouseMoved', p1.x + 70, p1.y, { buttons: 1 });
  await sleep(150);
  check('拖动中：进入预览（撤销按钮被锁）', (await evalJS(`document.getElementById('btnUndo').disabled`)) === true);
  check('拖动中：状态条显示"预览"', String(await text('#notice-text')).includes('预览'));
  const sstPreview = await text('[data-key="row:sst"] .val');
  check('拖动中：读数已随预览更新（≠17.50）', sstPreview !== '17.50', `实际 ${sstPreview}`);
  await mouse('mouseReleased', p1.x + 70, p1.y);
  await waitFor(() => evalJS(`document.getElementById('btnUndo').disabled === false`), { desc: '提交完成' });
  check('提交：状态条显示"已提交"', String(await text('#notice-text')).includes('已提交'));
  await membership('after-drag-commit');
  const sstAfterDrag = await text('[data-key="row:sst"] .val');
  check('提交后读数与预览一致', sstAfterDrag === sstPreview, `${sstAfterDrag} vs ${sstPreview}`);

  // ---------- 4. 撤销 / 重做 ----------
  await clickSel('#btnUndo');
  await waitFor(async () => (await text('[data-key="row:sst"] .val')) === '17.50', { desc: '撤销恢复' });
  check('撤销：读数恢复 17.50', true);
  await clickSel('#btnRedo');
  await waitFor(async () => (await text('[data-key="row:sst"] .val')) === sstAfterDrag, { desc: '重做恢复' });
  check('重做：读数回到拖动后值', true);

  // ---------- 5. 预览取消（Esc） ----------
  const p2 = await rectOf('[data-obs="obs-1"]');
  await mouse('mousePressed', p2.x, p2.y);
  await mouse('mouseMoved', p2.x + 60, p2.y, { buttons: 1 });
  await sleep(120);
  await key('Escape', 'Escape', 27);
  await waitFor(async () => String(await text('#notice-text')).includes('已取消'), { desc: '取消预览' });
  const sstAfterCancel = await text('[data-key="row:sst"] .val');
  check('取消预览：读数回到已提交值', sstAfterCancel === sstAfterDrag, `${sstAfterCancel} vs ${sstAfterDrag}`);
  await mouse('mouseReleased', p2.x + 60, p2.y);
  await sleep(120);
  check('取消后松手：不产生提交', (await text('[data-key="row:sst"] .val')) === sstAfterDrag);

  // ---------- 6. 关系图与检查器联动 ----------
  await clickSel('[data-key="rel:sst"]');
  await waitFor(async () => (await text('.insp .obj-id')) === 'sst', { desc: '检查器选中 sst' });
  check('点击关系图节点：检查器显示该对象', true);
  check('检查器含结构化定义（KaTeX 渲染）', (await evalJS(`document.querySelectorAll('.insp .formula .katex').length >= 2`)) === true);
  check('检查器输入来源包含 mean:grand', String(await evalJS(`[...document.querySelectorAll('.insp .ref-link')].map(e=>e.textContent).join(',')`)).includes('mean:grand'));
  // 检查器内引用跳转：sst → 其输入 mean:grand
  await clickSel('[data-goto="mean:grand"]');
  await waitFor(async () => (await text('.insp .obj-id')) === 'mean:grand', { desc: '跳转 mean:grand' });
  check('检查器内引用跳转（sst → mean:grand）', true);
  check('检查器反向引用（被谁引用）非空', (await evalJS(`document.querySelectorAll('.insp .ref-list .ref-link').length > 0`)) === true);

  // ---------- 7. 键盘路径：聚焦观测 → ←/→ 预览 → Enter 提交 ----------
  await evalJS(`document.querySelector('[data-obs="obs-2"]').focus()`);
  await key('ArrowRight', 'ArrowRight', 39);
  await sleep(120);
  check('键盘：方向键进入预览', String(await text('#notice-text')).includes('预览'));
  await key('Enter', 'Enter', 13);
  await waitFor(() => evalJS(`document.getElementById('btnUndo').disabled === false`), { desc: '键盘提交完成' });
  check('键盘：Enter 提交成功', String(await text('#notice-text')).includes('已提交'));
  await membership('after-keyboard-commit');

  // ---------- 8. 换组（键盘等价路径：聚焦观测 → Enter 选中 → 检查器按钮） ----------
  await evalJS(`document.querySelector('[data-obs="obs-4"]').focus()`);
  await key('Enter', 'Enter', 13); // 无预览时 Enter = 选中该观测
  await sleep(120);
  check('键盘：Enter 选中观测（检查器显示 obs-4）', (await text('.insp .obj-id')) === 'obs-4');
  check(
    '观测的检查器列出下游偏差链',
    String(await evalJS(`[...document.querySelectorAll('.insp .ref-link')].map(e=>e.textContent).join(',')`)).includes('dev:obs-4'),
  );
  await evalJS(`document.querySelector('#moveGroupSel').value = 'grp-1'`);
  await clickSel('[data-act="move-group"][data-target="obs-4"]');
  await sleep(200);
  const moveNotice = String(await text('#notice-text'));
  check('换组：提交成功', moveNotice.includes('obs-4'), moveNotice);
  const labels = String(await evalJS(`[...document.querySelectorAll('.group-label')].map(e=>e.textContent).join('|')`));
  const obs4Group = await evalJS(`window.__store.getSnapshot().source.dataset.observations.find(o=>o.id==='obs-4').groupId`);
  const probe = await evalJS(`(() => {
    const s = window.__store.getSnapshot();
    const g1 = s.source.dataset.observations.filter(o=>o.groupId==='grp-1').length;
    const n = document.querySelectorAll('.group-label').length;
    const ptKeys = [...document.querySelectorAll('.pt')].map(e=>e.getAttribute('data-obs')).join(',');
    return { g1, n, ptKeys, rev: s.source.dataset.revision };
  })()`);
  check('换组后 A 组 n=4 显示', labels.includes('n=4'), `notice=${moveNotice} | labels=${labels} | obs-4→${obs4Group} | probe=${JSON.stringify(probe)}`);

  // ---------- 9. 边界：清空 → 空数据集状态 ----------
  await clickSel('#btnReset');
  await waitFor(() => evalJS(`document.querySelector('.empty-state') !== null`), { desc: '回到空态' });
  check('清空：回到空工作台', true);
  await clickSel('#btnUndo');
  await waitFor(() => evalJS(`document.querySelectorAll('.pt').length === 6`), { desc: '撤销清空' });
  check('清空可撤销（回到 6 点）', true);

  // ---------- 10. reduced-motion 平价 ----------
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.reload', {});
  await waitFor(() => evalJS(`document.querySelector('.empty-state') !== null`), { desc: 're-reload' });
  await clickSel('#btnBench');
  await waitFor(async () => (await text('[data-key="row:sst"] .val')) === '17.50', { desc: 'reduced-motion 下读数' });
  check('reduced-motion：全部状态仍可读（读数 17.50）', true);
  check('reduced-motion：无页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await send('Emulation.setEmulatedMedia', { features: [] });

  // ---------- 11. 窄视口：三窗口保有访问路径 ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const boxes = await evalJS(`['win-canvas','win-inspector','win-relation'].map(id => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); return { id, w: Math.round(r.width), h: Math.round(r.height) }; })`);
  check('窄视口：三窗口均有非零尺寸', boxes.every((b) => b.w > 0 && b.h > 0), JSON.stringify(boxes));
  await send('Emulation.clearDeviceMetricsOverride');
} catch (e) {
  failures += 1;
  console.error('  FATAL  ' + (e?.message ?? e));
} finally {
  try {
    ws?.close();
  } catch {
    /* noop */
  }
  chrome.kill();
  await sleep(200);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) exitCode = 1;
process.exit(exitCode);
