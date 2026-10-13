// 关系图（F03 可视化）：分层 DAG（最长路径秩）。折叠与过滤只影响显示——数学对象图始终完整。
// 多上游显示全部入边；键盘 Tab 遍历 / Enter 选中 / Space 折叠；布局注记固定可见。
// 视觉映射边默认隐藏；隐藏不影响检查器的 Representation 列表（两者数据源独立）。

import type { Status } from '../kernel/types';
import type { Store, StoreSnapshot } from '../state/store';
import type { RepRegistry } from './reps';

const KIND_SHORT: Record<string, string> = {
  'def:count': '计数',
  'def:meanGroup': '组均值',
  'def:meanGrand': '总体均值',
  'def:deviation': '偏差',
  'def:devSq': '平方偏差',
  'def:gdev': '组均值偏差',
  'def:gdevSq': '组均值平方偏差',
  'def:ssw': '组内平方和',
  'def:ssb': '组间平方和',
  'def:sst': '总平方和',
  'def:identity': '恒等式',
};

const STATUS_SHORT: Record<Status, string> = { valid: '有效', pending: '待计算', undefined: '未定义', invalid: '冲突', error: '错误' };
const SEVERITY: Record<Status, number> = { valid: 0, pending: 0, undefined: 1, invalid: 2, error: 3 };

const COL_W = 216;
const NODE_W = 184;
const NODE_H = 50;
const GAP_Y = 14;
const PAD = 26;

interface DisplayNode {
  key: string;
  label: string;
  kindLabel: string;
  ids: string[];
  status: Status;
  fold: boolean;
  foldKind?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export function mountRelation(root: HTMLElement, store: Store, reps: RepRegistry): { render(snap: StoreSnapshot): void } {
  const expanded = new Set<string>(); // 观测级节点默认折叠（仅显示层；数学对象图始终完整）

  root.addEventListener('click', (ev) => {
    const el = (ev.target as Element).closest('[data-node]');
    if (el === null) return;
    activate(el.getAttribute('data-node') as string);
  });
  root.addEventListener('keydown', (ev) => {
    const el = (ev.target as Element).closest('[data-node]');
    if (el === null) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      activate(el.getAttribute('data-node') as string);
    }
  });

  function activate(key: string): void {
    if (key.startsWith('fold:')) {
      const kind = key.slice(5);
      if (expanded.has(kind)) expanded.delete(kind);
      else expanded.add(kind);
      render(store.getSnapshot());
      return;
    }
    const snap = store.getSnapshot();
    const node = buildNodes(snap).find((n) => n.key === key);
    const first = node?.ids[0];
    if (first !== undefined) store.setUi({ selectedId: first });
  }

  function buildNodes(snap: StoreSnapshot): DisplayNode[] {
    const { source, effective, ui } = snap;
    const objects = effective.objects;
    const nodes: DisplayNode[] = [];
    const obsIds = source.dataset.observations.map((o) => o.id);
    const selected = ui.selectedId;

    const obsKinds: { kind: string; prefix: string; defId: string }[] = [
      { kind: 'deviation', prefix: 'dev:', defId: 'def:deviation' },
      { kind: 'squaredDeviation', prefix: 'devsq:', defId: 'def:devSq' },
    ];
    for (const k of obsKinds) {
      if (obsIds.length === 0) continue;
      const all = obsIds.map((o) => `${k.prefix}${o}`).filter((id) => objects.has(id));
      if (all.length === 0) continue;
      // 选中观测时展开其链（即使该类别处于折叠态）
      const special =
        selected !== null && obsIds.includes(selected) ? [`${k.prefix}${selected}`].filter((id) => objects.has(id)) : [];
      const folded = all.filter((id) => !special.includes(id));
      for (const id of special) {
        nodes.push({ key: id, label: id, kindLabel: KIND_SHORT[k.defId] as string, ids: [id], status: objects.get(id)?.status ?? 'undefined', fold: false });
      }
      if (expanded.has(k.kind)) {
        for (const id of folded) {
          nodes.push({ key: id, label: id, kindLabel: KIND_SHORT[k.defId] as string, ids: [id], status: objects.get(id)?.status ?? 'undefined', fold: false });
        }
      } else if (folded.length > 0) {
        let worst: Status = 'valid';
        for (const id of folded) {
          const s = objects.get(id)?.status ?? 'valid';
          if (SEVERITY[s] > SEVERITY[worst]) worst = s;
        }
        nodes.push({
          key: `fold:${k.kind}`,
          label: `▶ ${KIND_SHORT[k.defId]} ×${folded.length}`,
          kindLabel: '折叠组 · 仅显示层',
          ids: folded,
          status: worst,
          fold: true,
          foldKind: k.kind,
        });
      }
    }

    for (const g of source.dataset.groups) {
      for (const [prefix, defId] of [
        ['count:', 'def:count'],
        ['mean:', 'def:meanGroup'],
        ['gdev:', 'def:gdev'],
        ['gdevsq:', 'def:gdevSq'],
      ] as const) {
        const id = `${prefix}${g.id}`;
        if (objects.has(id)) {
          nodes.push({ key: id, label: id, kindLabel: KIND_SHORT[defId] as string, ids: [id], status: objects.get(id)?.status ?? 'undefined', fold: false });
        }
      }
    }
    for (const id of ['mean:grand', 'ssw', 'ssb', 'sst', 'con:identity']) {
      if (objects.has(id)) {
        const obj = objects.get(id);
        nodes.push({ key: id, label: id, kindLabel: KIND_SHORT[obj?.defId ?? ''] ?? id, ids: [id], status: obj?.status ?? 'undefined', fold: false });
      }
    }
    return nodes;
  }

  function render(snap: StoreSnapshot): void {
    const { source, effective, ui } = snap;
    const objects = effective.objects;
    const nodes = buildNodes(snap);
    if (nodes.length === 0) {
      root.innerHTML = `<div class="panel"><div class="panel-body empty-hint">载入数据后，这里显示全部数学对象与它们之间的计算依赖。</div></div>`;
      return;
    }
    const nodeMap = new Map(nodes.map((n) => [n.key, n]));
    const byObjectId = new Map<string, string>();
    for (const n of nodes) for (const id of n.ids) byObjectId.set(id, n.key);

    // 分层秩（最长路径；仅显示布局，不表示因果或数学先后）
    const rankCache = new Map<string, number>();
    const visiting = new Set<string>();
    const rankOf = (key: string): number => {
      const cached = rankCache.get(key);
      if (cached !== undefined) return cached;
      if (visiting.has(key)) return 0;
      visiting.add(key);
      const n = nodeMap.get(key);
      let r = 0;
      if (n !== undefined) {
        for (const oid of n.ids) {
          const obj = objects.get(oid);
          if (obj === undefined) continue;
          for (const inp of obj.inputs) {
            const nk = byObjectId.get(inp);
            if (nk !== undefined && nk !== key) r = Math.max(r, rankOf(nk) + 1);
          }
        }
      }
      visiting.delete(key);
      rankCache.set(key, r);
      return r;
    };
    for (const n of nodes) rankOf(n.key);
    const maxRank = Math.max(...nodes.map((n) => rankCache.get(n.key) as number));

    // 视觉映射节点（可选；登记项独立于本视图的过滤）
    interface RepNode { key: string; label: string; from: string[] }
    const repNodes: RepNode[] = [];
    if (ui.showVisualEdges) {
      const kindMap = new Map<string, RepNode>();
      for (const n of nodes) {
        for (const oid of n.ids) {
          for (const r of reps.get(oid)) {
            const key = `rep:${r.viewId}:${r.kind}`;
            let rn = kindMap.get(key);
            if (rn === undefined) {
              rn = { key, label: `${r.viewId === 'canvas' ? '画布' : r.viewId === 'readings' ? '读数条' : r.viewId}·${r.kind}`, from: [] };
              kindMap.set(key, rn);
              repNodes.push(rn);
            }
            if (!rn.from.includes(n.key)) rn.from.push(n.key);
          }
        }
      }
    }

    const columns = new Map<number, string[]>();
    for (const n of nodes) {
      const r = rankCache.get(n.key) as number;
      const col = columns.get(r) ?? [];
      col.push(n.key);
      columns.set(r, col);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let maxY = 0;
    for (const [r, keys] of columns) {
      keys.forEach((k, i) => {
        const y = PAD + i * (NODE_H + GAP_Y);
        pos.set(k, { x: PAD + r * COL_W, y });
        maxY = Math.max(maxY, y + NODE_H);
      });
    }
    // 视觉映射节点放置在最后一列之后
    repNodes.forEach((rn, i) => {
      const y = PAD + i * (NODE_H + GAP_Y);
      pos.set(rn.key, { x: PAD + (maxRank + 1) * COL_W, y });
      maxY = Math.max(maxY, y + NODE_H);
    });

    const width = PAD * 2 + (maxRank + 1 + (repNodes.length > 0 ? 1 : 0)) * COL_W;
    const height = maxY + PAD;

    // 边（全部入边；折叠节点的边按成员聚合去重）
    const edgeSet = new Set<string>();
    const edges: { from: string; to: string; identity: boolean }[] = [];
    for (const n of nodes) {
      for (const oid of n.ids) {
        const obj = objects.get(oid);
        if (obj === undefined) continue;
        for (const inp of obj.inputs) {
          const src = byObjectId.get(inp);
          if (src === undefined || src === n.key) continue;
          const ek = `${src}→${n.key}`;
          if (edgeSet.has(ek)) continue;
          edgeSet.add(ek);
          edges.push({ from: src, to: n.key, identity: n.key === 'con:identity' });
        }
      }
    }

    const edgePath = (from: { x: number; y: number }, to: { x: number; y: number }): string => {
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x - 6;
      const y2 = to.y + NODE_H / 2;
      const mid = (x1 + x2) / 2;
      return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
    };

    const parts: string[] = [];
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (a === undefined || b === undefined) continue;
      parts.push(`<path class="rel-edge${e.identity ? ' identity' : ''}" d="${edgePath(a, b)}" marker-end="url(#rel-arrow)"/>`);
    }
    for (const rn of repNodes) {
      const b = pos.get(rn.key);
      if (b === undefined) continue;
      for (const fromKey of rn.from) {
        const a = pos.get(fromKey);
        if (a === undefined) continue;
        parts.push(`<path class="rel-edge visual" d="${edgePath(a, b)}" marker-end="url(#rel-arrow)"/>`);
      }
    }

    const nodeHtml = (n: DisplayNode, x: number, y: number): string => {
      const selected = n.ids.includes(ui.selectedId ?? '') || (n.fold && n.ids.includes(ui.selectedId ?? ''));
      const label = esc(n.label);
      return `<g class="rel-node ${n.status}${selected ? ' selected' : ''}" data-node="${esc(n.key)}" data-key="rel:${esc(n.key)}" tabindex="0" role="button"
        aria-label="${esc(n.label)}：${STATUS_SHORT[n.status]}${n.fold ? '（可展开/折叠）' : ''}"${n.fold ? ` aria-expanded="${String(expanded.has(n.foldKind ?? ''))}"` : ''}
        transform="translate(${x},${y})">
        <rect width="${NODE_W}" height="${NODE_H}" rx="0"/>
        <text x="9" y="20">${label}</text>
        <text class="st" x="9" y="37">${esc(n.kindLabel)} · ${STATUS_SHORT[n.status]}</text>
      </g>`;
    };

    const nodeParts: string[] = [];
    for (const n of nodes) {
      const p = pos.get(n.key);
      if (p !== undefined) nodeParts.push(nodeHtml(n, p.x, p.y));
    }
    for (const rn of repNodes) {
      const p = pos.get(rn.key);
      if (p !== undefined) {
        nodeParts.push(`<g class="rel-node valid" data-key="rel:${esc(rn.key)}" transform="translate(${p.x},${p.y})" aria-hidden="true">
          <rect width="${NODE_W}" height="${NODE_H}" stroke-dasharray="3 3"/>
          <text x="9" y="20">视觉映射</text>
          <text class="st" x="9" y="37">${esc(rn.label)} · 登记项</text>
        </g>`);
      }
    }

    root.innerHTML = `
      <p class="rel-note">布局（分层秩）仅为可读性排序，<b>不表示因果或数学先后顺序</b>；折叠仅影响显示，数学对象图始终完整。</p>
      <p class="rel-note">边：实线 = 计算依赖 · 粗线 = 恒等式 · 点线 = 视觉映射（可切换）</p>
      <svg width="${width}" height="${height}" role="group" aria-label="关系图：数学对象与计算依赖">
        <defs>
          <marker id="rel-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" class="rel-edge-arrow"/>
          </marker>
        </defs>
        ${parts.join('')}
        ${nodeParts.join('')}
      </svg>`;
  }

  return { render };
}
