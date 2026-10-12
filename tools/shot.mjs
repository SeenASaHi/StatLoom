// shot.mjs — 截图工具：无头浏览器打开原型，可选执行一段界面操作脚本后截图。
// 用法：node tools/shot.mjs 输出路径.png ["页面内要执行的 JS 片段"]
// 前置：本地服务器已启动（python -m http.server 8124）。

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outPath = process.argv[2];
const setupExpr = process.argv[3] ?? '';
const winSize = process.argv[4] ?? '1560,2600'; // 可选：宽,高（例如 480,1400 竖屏）
if (!outPath) {
  console.error('用法：node tools/shot.mjs 输出路径.png ["要执行的 JS"] [宽,高]');
  process.exit(2);
}

const URL_APP = 'http://localhost:8124/';
const PORT = 9224;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 8000, interval = 120, desc = 'condition' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* 重试 */ }
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
  console.error('未找到 Chrome 或 Edge。');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'statloom-shot-'));
const chrome = spawn(
  exe,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${winSize}`,
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
  if (!page) throw new Error('未找到页面 target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });

  let seq = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
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
    if (r.exceptionDetails) throw new Error('页面脚本异常：' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value;
  };

  await waitFor(() => evalJS(`!!document.querySelector('.gate-panel') || document.querySelectorAll('.specimen').length > 0`), { desc: '页面渲染完成' });
  if (setupExpr) {
    await evalJS(setupExpr);
    await sleep(500);
  }
  await sleep(250);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('截图已保存：' + outPath);
} catch (err) {
  console.error('截图失败：' + err.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  chrome.kill();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
