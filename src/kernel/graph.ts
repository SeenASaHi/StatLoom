// 依赖图的全部遍历逻辑（《统一依赖图规范》§4：唯一实现）。
// 构建、拓扑序、环检测、受影响集合、审计——rebuild 只编排，不重复遍历。

import type { AuditReport, DerivedObject, Draft, SourceState } from './types';
import { DEFINITIONS, instantiateAll } from './expressions';
import { buildVersionLookup } from './compute';
import { KernelCycleError } from './errors';

type Nodes = ReadonlyMap<string, { inputs: string[] }>;

/** 拓扑序（Kahn）。边 = inputs 中存在于节点集的 id。成环 → KernelCycleError。 */
export function topologicalOrder(nodes: Nodes): string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [id, n] of nodes) {
    let d = 0;
    for (const inp of n.inputs) {
      if (nodes.has(inp)) {
        d += 1;
        const arr = dependents.get(inp);
        if (arr === undefined) dependents.set(inp, [id]);
        else arr.push(id);
      }
    }
    indegree.set(id, d);
  }
  const queue = [...nodes.keys()].filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const d = (indegree.get(dep) as number) - 1;
      indegree.set(dep, d);
      if (d === 0) queue.push(dep);
    }
  }
  if (order.length !== nodes.size) {
    const done = new Set(order);
    throw new KernelCycleError([...nodes.keys()].filter((id) => !done.has(id)));
  }
  return order;
}

/** 受影响集合：从变更的源对象出发，沿依赖边正向可达的派生对象（在给定节点集内）。 */
export function affectedFrom(changedIds: Iterable<string>, nodes: Nodes): Set<string> {
  const consumers = new Map<string, string[]>();
  for (const [id, n] of nodes) {
    for (const inp of n.inputs) {
      const arr = consumers.get(inp);
      if (arr === undefined) consumers.set(inp, [id]);
      else arr.push(id);
    }
  }
  const affected = new Set<string>();
  const stack: string[] = [];
  for (const ch of changedIds) {
    for (const c of consumers.get(ch) ?? []) stack.push(c);
  }
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (affected.has(id)) continue;
    affected.add(id);
    for (const c of consumers.get(id) ?? []) stack.push(c);
  }
  return affected;
}

/**
 * 审计（《统一依赖图规范》§5）：重建完成后三项必须为空。
 * stale：签名（输入集合 / 输入版本 / ruleVersion）与当前状态不符，或对象集与期望不符。
 * pending：残留瞬时态。nonFinite：value/residual 非有限且状态非 error。
 */
export function audit(objects: ReadonlyMap<string, DerivedObject>, source: SourceState, drafts?: ReadonlyMap<string, Draft>): AuditReport {
  const expected = drafts ?? instantiateAll(source);
  const versionOf = buildVersionLookup(source, objects);
  const stale: string[] = [];
  for (const [id, draft] of expected) {
    const obj = objects.get(id);
    if (obj === undefined) {
      stale.push(id);
      continue;
    }
    if (obj.inputs.length !== draft.inputs.length || obj.inputs.some((x, i) => x !== draft.inputs[i])) {
      stale.push(id);
      continue;
    }
    const def = DEFINITIONS[draft.defId];
    if (def === undefined || obj.ruleVersion !== def.ruleVersion) {
      stale.push(id);
      continue;
    }
    for (const inp of obj.inputs) {
      const v = versionOf(inp);
      if (v === undefined || obj.inputsRevision[inp] !== v) {
        stale.push(id);
        break;
      }
    }
  }
  for (const id of objects.keys()) {
    if (!expected.has(id)) stale.push(id);
  }
  const pending: string[] = [];
  const nonFinite: string[] = [];
  for (const [id, obj] of objects) {
    if (obj.status === 'pending') pending.push(id);
    if (obj.status !== 'error') {
      if (obj.value !== undefined && !Number.isFinite(obj.value)) nonFinite.push(id);
      if (obj.residual !== undefined && !Number.isFinite(obj.residual)) nonFinite.push(id);
    }
  }
  return { stale, pending, nonFinite };
}
