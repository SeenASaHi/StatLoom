// 观测画布（F05）：点阵按组分行、共享数值轴；总均值实线、组均值虚线、
// 偏差线段（有向 + 端点短竖线）、平方块（面积 = 偏差² × s²，可开关）、分解口径在读数条。
// 交互：拖动改值 + 跨行换组（预览 → 提交）；键盘 ←→/Shift/Enter/Esc。
// 视图以 (snapshot.effective, ui) 为唯一输入；不缓存读数、不自行计算统计量。

import type { Command } from '../kernel/types';
import type { Store, StoreSnapshot } from '../state/store';
import { devSqId, deviationId, grandMeanId, meanId } from '../kernel/expressions';
import { fmt, makeValueScale, squareGeometry, type ValueScale } from './scale';
import type { RepRegistry } from './reps';

const VB_W = 800;
const PAD = { l: 108, r: 40, t: 36, b: 44 };
const MAX_LANE_H = 96;

interface Geom {
  svg: SVGSVGElement;
  scale: ValueScale;
  laneH: number;
  groupIds: string[];
}

interface DragState {
  obsId: string;
  startClientX: number;
  startClientY: number;
  started: boolean;
  canceled: boolean;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const c = raw / p;
  return (c <= 1 ? 1 : c <= 2 ? 2 : c <= 5 ? 5 : 10) * p;
}

function previewValueOf(cmd: Command, fallback: number): number {
  if (cmd.type === 'setValue' || cmd.type === 'setValueAndGroup') return cmd.value;
  return fallback;
}

export function mountCanvasView(
  root: HTMLElement,
  store: Store,
  reps: RepRegistry,
  openImport: () => void,
): { render(snap: StoreSnapshot): void } {
  let lastRevision = -1;
  let geom: Geom | null = null;
  let drag: DragState | null = null;
  let previewingObs: string | null = null;

  root.addEventListener('pointerdown', (ev) => {
    const el = (ev.target as Element).closest('[data-obs]');
    if (el === null) return;
    const obsId = el.getAttribute('data-obs') as string;
    const snap = store.getSnapshot();
    const obs = snap.source.dataset.observations.find((o) => o.id === obsId);
    if (obs === undefined) return;
    ev.preventDefault();
    drag = { obsId, startClientX: ev.clientX, startClientY: ev.clientY, started: false, canceled: false };
    el.classList.add('dragging');
  });

  window.addEventListener('pointermove', (ev) => {
    if (drag === null || drag.canceled || geom === null) return;
    const dist = Math.hypot(ev.clientX - drag.startClientX, ev.clientY - drag.startClientY);
    if (!drag.started) {
      if (dist < 3) return;
      drag.started = true;
    }
    const rect = geom.svg.getBoundingClientRect();
    const k = VB_W / rect.width;
    const svgX = (ev.clientX - rect.left) * k;
    const svgY = (ev.clientY - rect.top) * k;
    const rawV = (svgX - PAD.l) / geom.scale.s + geom.scale.domain.min;
    const value = Math.round(rawV * 100) / 100;
    const lane = Math.max(0, Math.min(geom.groupIds.length - 1, Math.floor((svgY - PAD.t) / geom.laneH)));
    const groupId = geom.groupIds[lane] as string;
    const cmd: Command = { type: 'setValueAndGroup', obsId: drag.obsId, value, groupId };
    const snap = store.getSnapshot();
    if (snap.ui.preview === null) store.beginPreview(cmd);
    else store.updatePreview(cmd);
  });

  window.addEventListener('pointerup', () => {
    if (drag === null) return;
    const d = drag;
    drag = null;
    for (const el of root.querySelectorAll('.pt.dragging')) el.classList.remove('dragging');
    if (d.canceled) return;
    if (!d.started) {
      store.setUi({ selectedId: d.obsId });
      return;
    }
    if (store.getSnapshot().ui.preview !== null) store.commitPreview();
  });

  root.addEventListener('keydown', (ev) => {
    const el = (ev.target as Element).closest('[data-obs]');
    if (el === null) return;
    const obsId = el.getAttribute('data-obs') as string;
    const snap = store.getSnapshot();
    const obs = snap.source.dataset.observations.find((o) => o.id === obsId);
    if (obs === undefined) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      const step = ev.shiftKey ? 5 : 0.5;
      const dir = ev.key === 'ArrowRight' ? 1 : -1;
      const base =
        previewingObs === obsId && snap.ui.preview !== null
          ? previewValueOf(snap.ui.preview.command, obs.value)
          : obs.value;
      const value = Math.round((base + dir * step) * 100) / 100;
      const cmd: Command = { type: 'setValue', obsId, value };
      if (snap.ui.preview === null || previewingObs !== obsId) {
        const res = store.beginPreview(cmd);
        if (res.ok) previewingObs = obsId;
      } else {
        store.updatePreview(cmd);
      }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (snap.ui.preview !== null) {
        store.commitPreview();
        previewingObs = null;
      } else {
        store.setUi({ selectedId: obsId });
      }
    } else if (ev.key === 'Escape') {
      if (snap.ui.preview !== null) {
        store.cancelPreview();
        previewingObs = null;
      }
      if (drag !== null) drag.canceled = true;
    }
  });

  function render(snap: StoreSnapshot): void {
    const { source, result, effective, ui } = snap;
    const pulse = source.dataset.revision !== lastRevision;
    lastRevision = source.dataset.revision;
    reps.clearView('canvas');

    const observations = source.dataset.observations;
    if (observations.length === 0) {
      geom = null;
      root.innerHTML = `
        <div class="panel"><div class="panel-body empty-state">
          <div class="big">空工作台</div>
          <p>没有数据。载入基准案例，或粘贴 CSV 导入（整批预检，坏行会阻止导入）。</p>
          <div class="io-actions" style="justify-content:center">
            <button data-act="bench">载入基准案例 A</button>
            <button data-act="import">粘贴导入</button>
          </div>
        </div></div>`;
      root.querySelector('[data-act="bench"]')?.addEventListener('click', () => {
        store.dispatch({ type: 'loadBenchmark' });
      });
      root.querySelector('[data-act="import"]')?.addEventListener('click', () => openImport());
      return;
    }

    const groups = source.dataset.groups;
    const groupIds = groups.map((g) => g.id);
    const laneH = Math.max(44, Math.min(MAX_LANE_H, 480 / Math.max(1, groups.length)));
    const plotH = laneH * groups.length;
    const vbH = PAD.t + plotH + PAD.b;

    const values = observations.map((o) => o.value);
    const means: number[] = [];
    for (const g of groups) {
      const v = effective.objects.get(meanId(g.id))?.value;
      if (v !== undefined) means.push(v);
    }
    const grand = effective.objects.get(grandMeanId)?.value;
    if (grand !== undefined) means.push(grand);
    const scale = makeValueScale(values, means, { left: PAD.l, right: VB_W - PAD.r, top: PAD.t, bottom: PAD.t + plotH });

    const signal = new Set<string>();
    if (ui.selectedId !== null) signal.add(ui.selectedId);
    if (ui.preview !== null) {
      for (const id of effective.changedObjectIds) signal.add(id);
    }
    const changedSet = new Set(pulse ? result.changedObjectIds : []);
    const cls = (base: string, ids: string[]): string => {
      let c = base;
      if (ids.some((id) => signal.has(id))) c += ' signal';
      if (pulse && ids.some((id) => changedSet.has(id))) c += ' just-changed-ink';
      return c;
    };

    const parts: string[] = [];
    // 值轴刻度：细分网格线 + 底部刻度与标签（技术标记均有信息角色）
    const ticks: number[] = [];
    const step = niceStep((scale.domain.max - scale.domain.min) / 6);
    for (let v = Math.ceil(scale.domain.min / step) * step; v <= scale.domain.max + 1e-9; v += step) {
      ticks.push(Number(v.toFixed(6)));
    }
    for (const tv of ticks) {
      const x = scale.x(tv);
      parts.push(`<line class="lane-guide" x1="${x.toFixed(2)}" y1="${PAD.t}" x2="${x.toFixed(2)}" y2="${(PAD.t + plotH).toFixed(2)}"/>`);
      parts.push(`<line class="axis-tick" x1="${x.toFixed(2)}" y1="${(PAD.t + plotH).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(PAD.t + plotH + 8).toFixed(2)}"/>`);
      parts.push(`<text class="axis-label" x="${x.toFixed(2)}" y="${(PAD.t + plotH + 24).toFixed(2)}" text-anchor="middle">${fmt(tv, Math.abs(step) < 1 ? 1 : 0)}</text>`);
    }

    // 总均值贯穿实线
    if (grand !== undefined) {
      const gx = scale.x(grand);
      parts.push(`<line class="${cls('grandline', [grandMeanId])}" x1="${gx.toFixed(2)}" y1="${PAD.t}" x2="${gx.toFixed(2)}" y2="${(PAD.t + plotH).toFixed(2)}"/>`);
      parts.push(`<text class="meanlabel" x="${(gx + 5).toFixed(2)}" y="${(PAD.t - 12).toFixed(2)}">ȳ = ${fmt(grand)}</text>`);
      reps.register(grandMeanId, { viewId: 'canvas', kind: 'mean-line', elementKey: 'grandline' });
    }

    groups.forEach((g, gi) => {
      const laneTop = PAD.t + gi * laneH;
      const centerY = laneTop + laneH / 2;
      parts.push(`<line class="lane-guide" x1="${PAD.l}" y1="${centerY.toFixed(2)}" x2="${VB_W - PAD.r}" y2="${centerY.toFixed(2)}"/>`);
      const count = observations.filter((o) => o.groupId === g.id).length;
      parts.push(`<text class="group-label" x="${PAD.l - 12}" y="${(centerY + 4).toFixed(2)}" text-anchor="end">${esc(g.name)} · n=${count}</text>`);

      const meanObj = effective.objects.get(meanId(g.id));
      if (meanObj !== undefined && meanObj.value !== undefined) {
        const mx = scale.x(meanObj.value);
        parts.push(`<line class="${cls('groupline', [meanId(g.id)])}" x1="${mx.toFixed(2)}" y1="${(laneTop + 8).toFixed(2)}" x2="${mx.toFixed(2)}" y2="${(laneTop + laneH - 8).toFixed(2)}"/>`);
        parts.push(`<text class="meanlabel ${ui.selectedId === meanId(g.id) ? 'current' : ''}" x="${(mx + 5).toFixed(2)}" y="${(laneTop + 18).toFixed(2)}">ȳ<tspan baseline-shift="sub" font-size="9.5">${esc(g.name)}</tspan> = ${fmt(meanObj.value)}</text>`);
        reps.register(meanId(g.id), { viewId: 'canvas', kind: 'mean-line', elementKey: `gline:${g.id}` });
      }

      for (const o of observations) {
        if (o.groupId !== g.id) continue;
        const x = scale.x(o.value);
        const y = centerY;
        // 偏差线段 + 端点短竖线
        if (meanObj?.value !== undefined) {
          const mx = scale.x(meanObj.value);
          const dcls = cls('devline', [deviationId(o.id), o.id]);
          parts.push(`<line class="${dcls}" x1="${mx.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"/>`);
          parts.push(`<line class="${dcls}" x1="${mx.toFixed(2)}" y1="${(y - 5).toFixed(2)}" x2="${mx.toFixed(2)}" y2="${(y + 5).toFixed(2)}"/>`);
          parts.push(`<line class="${dcls}" x1="${x.toFixed(2)}" y1="${(y - 5).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(y + 5).toFixed(2)}"/>`);
          reps.register(deviationId(o.id), { viewId: 'canvas', kind: 'deviation-segment', elementKey: `dev:${o.id}` });
          // 平方块（面积 = 偏差² × s²；超界裁切并标记，不改变侧长）
          const sq = effective.objects.get(devSqId(o.id));
          if (ui.showSquares && sq?.value !== undefined) {
            const geo = squareGeometry(o.value - meanObj.value, mx, y, scale, laneH / 2);
            parts.push(`<rect class="${cls('squareblock', [devSqId(o.id)])}" x="${geo.x.toFixed(2)}" y="${geo.y.toFixed(2)}" width="${geo.side.toFixed(2)}" height="${geo.side.toFixed(2)}"/>`);
            if (geo.clipped) {
              parts.push(`<text class="clip-mark" x="${(geo.x + 3).toFixed(2)}" y="${(geo.y + 13).toFixed(2)}">裁切</text>`);
            }
            reps.register(devSqId(o.id), { viewId: 'canvas', kind: 'square-block', elementKey: `sq:${o.id}` });
          }
        }
        const selected = ui.selectedId === o.id;
        parts.push(
          `<circle class="pt${selected ? ' selected' : ''}${pulse && changedSet.has(o.id) ? ' just-changed-ink' : ''}" ` +
            `data-obs="${o.id}" data-key="pt:${o.id}" tabindex="0" role="button" ` +
            `aria-label="观测 ${o.id}：值 ${o.value.toFixed(2)}，组 ${esc(g.name)}（方向键调整，回车提交，Esc 取消）" ` +
            `cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${selected ? 8.5 : 6.5}"/>`,
        );
        reps.register(o.id, { viewId: 'canvas', kind: 'point', elementKey: `pt:${o.id}` });
        if (selected) {
          parts.push(`<text class="pt-label" x="${(x + 9).toFixed(2)}" y="${(y - 10).toFixed(2)}">${o.value.toFixed(2)}</text>`);
        }
      }
    });

    root.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <span>观测画布 · ${esc(source.dataset.label)}</span>
          <span>${previewLabel(ui.preview?.command, source)}</span>
        </div>
        <div class="panel-body" style="padding:0">
          <svg viewBox="0 0 ${VB_W} ${vbH.toFixed(0)}" role="group" aria-label="观测画布：按组分行、共享数值轴">
            <defs>
              <pattern id="sl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--sl-paper)"/>
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--sl-ink)" stroke-width="1.4"/>
              </pattern>
            </defs>
            <rect class="plot-bg" x="0" y="0" width="${VB_W}" height="${vbH.toFixed(0)}"/>
            ${parts.join('')}
            <line class="axis-line" x1="${PAD.l}" y1="${(PAD.t + plotH).toFixed(2)}" x2="${VB_W - PAD.r}" y2="${(PAD.t + plotH).toFixed(2)}"/>
          </svg>
        </div>
        <div class="panel-head" style="border-top:1px solid var(--sl-hairline);border-bottom:none">
          <span>平方块：侧长 = |偏差| × 比例尺，面积 ∝ 偏差²（与数值轴同一比例尺；超界裁切并标记）</span>
        </div>
        <div class="panel-head" style="border-bottom:none;text-transform:none">
          <span>背景点云为数据场的示意表达（簇 ≈ 组，不承载读数）；精确读数只在本窗口与检查器内。</span>
        </div>
      </div>`;

    const svg = root.querySelector('svg');
    geom = svg === null ? null : { svg: svg as SVGSVGElement, scale, laneH, groupIds };
  }

  return { render };
}

function previewLabel(cmd: Command | undefined, source: StoreSnapshot['source']): string {
  if (cmd === undefined) return '';
  if (cmd.type === 'setValue' || cmd.type === 'setValueAndGroup') {
    const g = cmd.type === 'setValueAndGroup' ? source.dataset.groups.find((x) => x.id === cmd.groupId)?.name : undefined;
    return `预览 ${cmd.obsId} → ${cmd.value.toFixed(1)}${g !== undefined ? ` · ${esc(g)}` : ''}（未提交）`;
  }
  return '预览（未提交）';
}
