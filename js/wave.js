// wave.js — 点阵波浪背景
// 底图点阵由 CSS 绘制；这里只绘制一层缓慢行进的高亮点，随行波起伏（纯装饰层，aria-hidden）。
// 振幅、频率与对比度都保持克制：不遮挡正文、不暗示任何实时状态。
// prefers-reduced-motion: reduce 时只绘制一帧静态画面，不启动循环。

const SPACING = 24;
const K = 0.028; // 空间频率
const SPEED = 0.9; // rad/s（周期约 7s）

export function initWave(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (let y = SPACING / 2; y < H; y += SPACING) {
      for (let x = SPACING / 2; x < W; x += SPACING) {
        const amp = Math.sin(x * K * 1.6 + y * K * 0.9 - t * SPEED);
        if (amp <= 0.2) continue;
        const lift = (amp - 0.2) / 0.8; // 0..1
        const r = 1.1 + lift * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(82, 98, 20, ${(0.05 + lift * 0.22).toFixed(3)})`;
        ctx.fill();
      }
    }
  }

  resize();
  window.addEventListener('resize', resize);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) {
    draw(0); // 静态一帧
    return;
  }

  const t0 = performance.now();
  function loop(now) {
    draw((now - t0) / 1000);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
