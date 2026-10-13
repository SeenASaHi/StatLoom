// 重建（《统一依赖图规范》§4）：增量与全量的唯一实现——prev 参数有无决定复用程度。
// 流程：实例化 → 拓扑序 → 签名匹配则复用 prev 实例，否则求值 → 审计（非空即内核错误）→ Result。

import type { DerivedObject, Result, SourceState } from './types';
import { DEFINITIONS, buildSourceIndex, instantiateAll, type EvalEnv } from './expressions';
import { buildVersionLookup, evaluateDraft, makeObject } from './compute';
import { audit, topologicalOrder } from './graph';
import { KernelError } from './errors';

export function rebuild(source: SourceState, prev?: ReadonlyMap<string, DerivedObject>): Result {
  const index = buildSourceIndex(source);
  const drafts = instantiateAll(source);
  const order = topologicalOrder(drafts);

  const objects = new Map<string, DerivedObject>();
  const changed = new Set<string>();
  const lookupVersion = buildVersionLookup(source, objects);
  const versionOf = (id: string): number => {
    const v = lookupVersion(id);
    if (v === undefined) {
      throw new KernelError(`输入 ${id} 的版本不可得（内核缺陷：拓扑序或输入推导有误）`);
    }
    return v;
  };

  // 求值环境：输入先于被依赖者在拓扑序中落定，故 lookup 只需本批已处理对象
  const env: EvalEnv = { index, lookup: (id) => objects.get(id) };

  for (const id of order) {
    const draft = drafts.get(id);
    if (draft === undefined) throw new KernelError(`实例化缺少 ${id}（内核缺陷）`);
    const def = DEFINITIONS[draft.defId];
    if (def === undefined) throw new KernelError(`未注册的定义 ${draft.defId}`);

    const prevObj = prev?.get(id);
    const reusable =
      prevObj !== undefined &&
      prevObj.ruleVersion === def.ruleVersion &&
      prevObj.inputs.length === draft.inputs.length &&
      prevObj.inputs.every((x, i) => x === draft.inputs[i]) &&
      draft.inputs.every((inp) => prevObj.inputsRevision[inp] === versionOf(inp));

    if (reusable && prevObj !== undefined) {
      objects.set(id, prevObj);
      continue;
    }

    const { outcome, residual } = evaluateDraft(draft, env);
    const obj = makeObject(draft, outcome, residual, { prev: prevObj, versionOf });
    objects.set(id, obj);
    changed.add(id);
  }

  const report = audit(objects, source, drafts);
  if (report.stale.length > 0 || report.pending.length > 0 || report.nonFinite.length > 0) {
    throw new KernelError(
      `重建后审计未通过：stale=[${report.stale.join(', ')}] pending=[${report.pending.join(', ')}] nonFinite=[${report.nonFinite.join(', ')}]`,
    );
  }

  return { source, objects, changedObjectIds: [...changed] };
}

/** 源状态深度相等（no-op 判定；显式字段比较，不依赖键序）。 */
export function deepEqualSource(a: SourceState, b: SourceState): boolean {
  if (a.schemaVersion !== b.schemaVersion || a.idCounter !== b.idCounter) return false;
  const da = a.dataset;
  const db = b.dataset;
  if (da.id !== db.id || da.label !== db.label || da.version !== db.version || da.revision !== db.revision) return false;
  if (da.bindings.responseId !== db.bindings.responseId || da.bindings.groupingId !== db.bindings.groupingId) return false;
  if (da.variables.length !== db.variables.length) return false;
  for (let i = 0; i < da.variables.length; i += 1) {
    const x = da.variables[i] as (typeof da.variables)[number];
    const y = db.variables[i] as (typeof db.variables)[number];
    if (x.id !== y.id || x.version !== y.version || x.name !== y.name || x.kind !== y.kind || x.semantic !== y.semantic) return false;
  }
  if (da.groups.length !== db.groups.length) return false;
  for (let i = 0; i < da.groups.length; i += 1) {
    const x = da.groups[i] as (typeof da.groups)[number];
    const y = db.groups[i] as (typeof db.groups)[number];
    if (x.id !== y.id || x.version !== y.version || x.name !== y.name) return false;
  }
  if (da.observations.length !== db.observations.length) return false;
  for (let i = 0; i < da.observations.length; i += 1) {
    const x = da.observations[i] as (typeof da.observations)[number];
    const y = db.observations[i] as (typeof db.observations)[number];
    if (x.id !== y.id || x.version !== y.version || x.groupId !== y.groupId || x.value !== y.value) return false;
  }
  return true;
}
