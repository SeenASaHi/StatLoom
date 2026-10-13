// shot.mjs — CDP 截图（桌面 1440×900 与窄视口 900×1200 是相互独立的测试目标）。
// 前置：test3 目录运行 `npm run dev`。输出：.shots/*.png

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_APP = 'http://localhost:5173/';
const PORT = 9224;
const OUT = '.shots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 10000, interval = 150, desc = 'condition' } = {}) {
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

const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!exe) {
  console.error('未找到浏览器。');
  process.exit(2);
}
try {
  await fetch(URL_APP);
} catch {
  console.error('请先在 test3/ 运行 npm run dev。');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'statloom-shot-'));
const chrome = spawn(
  exe,
  ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,900', URL_APP],
  { stdio: 'ignore' },
);

try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok, { desc: '调试端口' });
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WS 失败'));
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
  const evalJS = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

  await send('Runtime.enable');
  await send('Page.enable');
  await waitFor(() => evalJS(`document.querySelector('.empty-state') !== null`), { desc: '首屏' });

  const snap = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('shot:', join(OUT, name));
  };

  await snap('01-empty-1440.png');
  await evalJS(`document.getElementById('btnBench').click()`);
  await waitFor(() => evalJS(`document.querySelectorAll('.pt').length === 6`), { desc: '基准载入' });
  await sleep(900); // 入场动效结束 + 波浪一帧
  await snap('02-benchmark-1440.png');
  // 选中一个观测（键盘路径），展开检查器与联动高亮
  await evalJS(`(() => { const el = document.querySelector('[data-obs="obs-5"]'); el.focus(); })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(400);
  await snap('03-selected-1440.png');
  // 关系图展开折叠组 + 视觉映射边（先滚到关系图窗口）
  await evalJS(`document.getElementById('btnVisual').click()`);
  await evalJS(`document.getElementById('win-relation').scrollIntoView({ block: 'end' })`);
  await evalJS(`(() => { const el = document.querySelector('[data-node="fold:deviation"]'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(400);
  await snap('04-relation-open-1440.png');

  // 灰度检查：关掉颜色后层级（窗口/面板/标注）与选中态仍应可辨
  await evalJS(`window.scrollTo(0, 0)`);
  await evalJS(`document.documentElement.style.filter = 'grayscale(1)'`);
  await sleep(300);
  await snap('06-grayscale-1440.png');
  await evalJS(`document.documentElement.style.filter = ''`);

  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await snap('05-narrow-900.png');
  await send('Emulation.clearDeviceMetricsOverride');

  ws.close();
} catch (e) {
  console.error('FATAL', e?.message ?? e);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await sleep(200);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}
