// L0 环境层（statloom-ui ambient-cloud）：簇 = 组、波浪 = 数据的连续变化、光带 = 当前对象。
// 不承担任何读数、不参与交互。reduced-motion 下不启动波浪，光带定格在画布中央的一帧静态点阵。

import type { SourceState } from '../kernel/types';

export interface AmbientHandle {
  /** 数据或选中变化时调用；内部按签名决定是否重建点集 */
  update(source: SourceState, selectedGroupId: string | null): void;
  /** 数据刚发生变化（提交/预览）：波浪幅度短暂增强后衰减 */
  pulse(): void;
  destroy(): void;
}

const TOTAL_POINTS = 1100;
const DUST = 420;

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function gauss(rnd: () => number): [number, number] {
  const u1 = Math.max(rnd(), 1e-6);
  const u2 = rnd();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

export function mountAmbient(canvas: HTMLCanvasElement): AmbientHandle {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BAND = 46;
  const AMP = 11;
  const LAMBDA = 520;
  const OMEGA = 0.0011;
  const SCAN = 4200;
  const DWELL = 0.22;

  let W = 0;
  let H = 0;
  let paused = reduce;
  let boost = 0;
  let lastPulse = -1e9;

  let signature = '';
  let clusters: { cx: number; cy: number; s: number }[] = [];
  let points: { bx: number; by: number; ph: number; amp: number; layer: number }[] = [];
  let dust: { bx: number; by: number; ph: number; amp: number }[] = [];
  let selectedGroup: string | null = null;
  let groupOrder: string[] = [];

  const rnd = lcg(20260113);
  const dustFixed = Array.from({ length: DUST }, () => ({
    bx: rnd(),
    by: rnd(),
    ph: rnd() * 6.2832,
    amp: 0.4 + rnd() * 0.9,
  }));
  dust = dustFixed;

  function rebuild(source: SourceState): void {
    const groups = source.dataset.groups;
    const stats = groups.map((g) => {
      const values = source.dataset.observations.filter((o) => o.groupId === g.id).map((o) => o.value);
      const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return { id: g.id, count: values.length, mean };
    });
    const withObs = stats.filter((s) => s.count > 0);
    const means = withObs.map((s) => s.mean);
    const lo = means.length > 0 ? Math.min(...means) : 0;
    const hi = means.length > 0 ? Math.max(...means) : 1;
    const span = hi - lo || 1;

    clusters = [];
    points = [];
    groupOrder = [];
    const totalCount = withObs.reduce((a, s) => a + s.count, 0);
    for (let i = 0; i < withObs.length; i += 1) {
      const s = withObs[i] as (typeof withObs)[number];
      const cx = withObs.length === 1 ? 0.5 : 0.14 + 0.72 * ((s.mean - lo) / span);
      const cy = 0.5 + (i - (withObs.length - 1) / 2) * 0.17;
      clusters.push({ cx, cy, s: 0.10 });
      groupOrder.push(s.id);
      const n = Math.max(90, Math.round((TOTAL_POINTS * s.count) / totalCount));
      for (let j = 0; j < n; j += 1) {
        const z = gauss(rnd);
        const bx = cx + z[0] * 0.10;
        const by = cy + z[1] * 0.11;
        if (bx < -0.06 || bx > 1.06 || by < -0.06 || by > 1.06) continue;
        points.push({ bx, by, ph: rnd() * 6.2832, amp: 0.5 + rnd() * 0.9, layer: rnd() < 0.55 ? 1 : 2 });
      }
    }
    if (clusters.length === 0) {
      // 空数据：没有簇（不在没有数据的地方放点云），仅有浮尘与待机扫描
      signature = 'empty';
      return;
    }
  }

  function theme(): { BG: string; GRID: string; PT: string; PTA: number } {
    const cs = getComputedStyle(document.body);
    return {
      BG: cs.getPropertyValue('--bg').trim() || '#191919',
      GRID: cs.getPropertyValue('--bg-grid').trim() || 'rgba(255,250,0,.05)',
      PT: cs.getPropertyValue('--bg-pt').trim() || '217,217,217',
      PTA: parseFloat(cs.getPropertyValue('--bg-pt-a')) || 0.42,
    };
  }

  let dpr = 1;
  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function front(i: number, t: number): number {
    if (paused || reduce) return W * (0.22 + 0.24 * i);
    const d = SCAN / (i + 1);
    const tt = t - 2000 * Math.log(i + 1);
    if (tt < 0) return -1;
    return (W + 220) * Math.min((tt / d) % (1 + DWELL), 1) - 110;
  }

  function bandTarget(t: number): number {
    if (reduce || paused) {
      const idx = selectedGroup !== null ? groupOrder.indexOf(selectedGroup) : -1;
      return W * (idx >= 0 ? (clusters[idx]?.cx ?? 0.5) : 0.5);
    }
    if (selectedGroup !== null) {
      const idx = groupOrder.indexOf(selectedGroup);
      if (idx >= 0) return W * (clusters[idx]?.cx ?? 0.5);
    }
    return (W + 220) * Math.min((t / SCAN) % (1 + DWELL), 1) - 110;
  }

  let bandX = -999;
  function draw(t: number): void {
    const { BG, GRID, PT, PTA } = theme();
    ctx?.fillStyle && (ctx.fillStyle = BG);
    ctx?.fillRect(0, 0, W, H);

    ctx!.strokeStyle = GRID;
    ctx!.lineWidth = 1;
    for (let i = 1; i < 10; i += 1) {
      ctx!.beginPath();
      ctx!.moveTo((W * i) / 10, 0);
      ctx!.lineTo((W * i) / 10, H);
      ctx!.stroke();
    }
    for (let j = 1; j < 5; j += 1) {
      ctx!.beginPath();
      ctx!.moveTo(0, (H * j) / 5);
      ctx!.lineTo(W, (H * j) / 5);
      ctx!.stroke();
    }

    const f0 = front(0, t);
    if (f0 >= 0) {
      const g = ctx!.createLinearGradient(f0 - BAND * 2, 0, f0 + BAND * 2, 0);
      g.addColorStop(0, 'rgba(255,250,0,0)');
      g.addColorStop(0.5, 'rgba(255,250,0,.09)');
      g.addColorStop(1, 'rgba(255,250,0,0)');
      ctx!.fillStyle = g;
      ctx!.fillRect(f0 - BAND * 2, 0, BAND * 4, H);
    }

    const target = bandTarget(t);
    if (bandX < -100) bandX = target;
    bandX += (target - bandX) * (reduce ? 1 : 0.05);

    const waveAmp = AMP * (0.35 + 0.9 * boost);

    for (const o of dust) {
      const x = o.bx * W;
      const y = o.by * H + (reduce ? 0 : Math.sin((x / LAMBDA) * 6.2832 + OMEGA * t + o.ph) * waveAmp * 0.7 * o.amp);
      ctx!.fillStyle = `rgba(${PT},.12)`;
      ctx!.beginPath();
      ctx!.arc(x, y, 1.1, 0, 6.2832);
      ctx!.fill();
    }

    for (const o of points) {
      const x = o.bx * W;
      const y = o.by * H + (reduce ? 0 : Math.sin((x / LAMBDA) * 6.2832 + OMEGA * t + o.ph) * waveAmp * o.amp);
      const d = Math.abs(x - bandX);
      if (d < BAND) {
        const k = Math.cos((d / BAND) * (Math.PI / 2));
        ctx!.fillStyle = `rgba(255,250,0,${(0.3 + 0.45 * k).toFixed(3)})`;
        ctx!.beginPath();
        ctx!.arc(x, y, 1.9, 0, 6.2832);
        ctx!.fill();
      } else {
        ctx!.fillStyle = `rgba(${PT},${((-0.25 * o.layer + 1.25) * PTA).toFixed(3)})`;
        ctx!.beginPath();
        ctx!.arc(x, y, 1.6, 0, 6.2832);
        ctx!.fill();
      }
    }

    const alphas = reduce ? [0.4, 0, 0] : [0.5, 0.26, 0.14];
    for (let i = 0; i < 3; i += 1) {
      const fx = reduce ? bandX : front(i, t);
      if (fx < 0 || alphas[i] === 0) continue;
      ctx!.strokeStyle = `rgba(255,250,0,${alphas[i]})`;
      ctx!.lineWidth = i === 0 ? 1.4 : 1;
      ctx!.beginPath();
      ctx!.moveTo(fx, 0);
      ctx!.lineTo(fx, H);
      ctx!.stroke();
    }
  }

  let start = 0;
  let prev = 0;
  let vt = 0;
  let raf = 0;

  function frame(ts: number): void {
    if (start === 0) {
      start = ts;
      prev = ts;
    }
    const dt = Math.min(ts - prev, 120);
    if (!paused && !document.hidden) vt += dt;
    prev = ts;
    // 波浪幅度的脉冲衰减（数据变化后约 1.6s 内回落）
    const since = performance.now() - lastPulse;
    boost = Number.isFinite(since) ? Math.max(0, 1 - since / 1600) : 0;
    draw(vt);
    raf = requestAnimationFrame(frame);
  }

  const onResize = (): void => resize();
  const onVis = (): void => {
    prev = 0;
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVis);

  resize();
  raf = requestAnimationFrame(frame);

  return {
    update(source: SourceState, selectedGroupId: string | null): void {
      selectedGroup = selectedGroupId;
      const sig = source.dataset.groups
        .map((g) => {
          const values = source.dataset.observations.filter((o) => o.groupId === g.id).map((o) => o.value);
          const mean = values.length > 0 ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : 'x';
          return `${g.id}:${values.length}:${mean}`;
        })
        .join('|');
      if (sig !== signature) {
        signature = sig;
        rebuild(source);
      }
      if (selectedGroupId !== null && groupOrder.length === 0) {
        // 空态下选中的是组但无簇：保持待机
      }
    },
    pulse(): void {
      lastPulse = performance.now();
      boost = 1;
    },
    destroy(): void {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
