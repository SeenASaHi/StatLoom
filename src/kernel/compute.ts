// 求值编排、状态判定、容差与格式化（《状态与事务规范》§1/§2/§7）。
// 定义注册表在 expressions.ts（数据）；本文件不含按 kind 分支的计算。

import type { DerivedObject, Draft, EvalOutcome, SourceState, Status } from './types';
import { DEFINITIONS, evaluateExpr, ssBetweenId, ssTotalId, ssWithinId, type EvalEnv } from './expressions';
import { KernelError } from './errors';

// ---------- 常量（容差配置：测试引用同一常量） ----------

export const TOLERANCE = { atol: 1e-9, rtol: 1e-9 } as const;

export const MAX_OBSERVATIONS = 200;
export const MAX_GROUPS = 8;
export const HISTORY_CAP = 200;

export function identityThreshold(ssw: number, ssb: number, sst: number): number {
  return TOLERANCE.atol + TOLERANCE.rtol * Math.max(Math.abs(sst), Math.abs(ssw), Math.abs(ssb), 1);
}

// ---------- 版本查找 ----------

export function buildSourceVersions(source: SourceState): Map<string, number> {
  const m = new Map<string, number>();
  m.set(source.dataset.id, source.dataset.version);
  for (const v of source.dataset.variables) m.set(v.id, v.version);
  for (const g of source.dataset.groups) m.set(g.id, g.version);
  for (const o of source.dataset.observations) m.set(o.id, o.version);
  return m;
}

export function buildVersionLookup(
  source: SourceState,
  objects: ReadonlyMap<string, DerivedObject>,
): (id: string) => number | undefined {
  const src = buildSourceVersions(source);
  return (id: string) => objects.get(id)?.version ?? src.get(id);
}

// ---------- 单对象求值 ----------

export interface DraftOutcome {
  outcome: EvalOutcome;
  /** 仅 constraint：未格式化原始残差 */
  residual?: number;
}

export function evaluateDraft(draft: Draft, env: EvalEnv): DraftOutcome {
  const def = DEFINITIONS[draft.defId];
  if (def === undefined) throw new KernelError(`未注册的定义 ${draft.defId}`);
  const outcome = evaluateExpr(def.template, { index: env.index, bindings: draft.bindings }, env);

  if (def.class !== 'constraint') return { outcome };

  // 恒等式约束：模板求值给出残差，再做容差判定（判定基于数值，非格式化）
  if (outcome.status !== 'valid') return { outcome };
  const residual = outcome.value as number;
  const ssw = env.lookup(ssWithinId)?.value;
  const ssb = env.lookup(ssBetweenId)?.value;
  const sst = env.lookup(ssTotalId)?.value;
  if (ssw === undefined || ssb === undefined || sst === undefined) {
    throw new KernelError('恒等式阈值计算缺少输入值（内核缺陷：状态传播未拦截）');
  }
  const threshold = identityThreshold(ssw, ssb, sst);
  if (Math.abs(residual) > threshold) {
    return {
      residual,
      outcome: {
        status: 'invalid',
        value: residual,
        reason: {
          code: 'tolerance-exceeded',
          message: `恒等式残差 ${residual} 超出容差 ${threshold}`,
          inputs: [ssWithinId, ssBetweenId, ssTotalId],
        },
      },
    };
  }
  return { residual, outcome: { status: 'valid', value: residual } };
}

// ---------- 对象落定（version 递增规则 + inputsRevision） ----------

export interface FinalizeContext {
  prev?: DerivedObject;
  /** 输入 id → 当前版本（源对象 version 或本批派生对象 version） */
  versionOf: (id: string) => number;
}

export function makeObject(
  draft: Draft,
  outcome: EvalOutcome,
  residual: number | undefined,
  ctx: FinalizeContext,
): DerivedObject {
  const def = DEFINITIONS[draft.defId];
  if (def === undefined) throw new KernelError(`未注册的定义 ${draft.defId}`);
  const obj: DerivedObject = {
    id: draft.id,
    defId: draft.defId,
    class: draft.class,
    bindings: draft.bindings,
    refs: draft.refs,
    inputs: draft.inputs,
    version: 1,
    status: outcome.status,
    reason: outcome.reason,
    value: draft.class === 'constraint' ? undefined : outcome.value,
    residual: draft.class === 'constraint' ? residual : undefined,
    inputsRevision: {},
    ruleVersion: def.ruleVersion,
  };
  for (const id of draft.inputs) obj.inputsRevision[id] = ctx.versionOf(id);
  if (ctx.prev !== undefined) {
    obj.version = sameContent(ctx.prev, obj) ? ctx.prev.version : ctx.prev.version + 1;
  }
  return obj;
}

function sameContent(a: DerivedObject, b: DerivedObject): boolean {
  if (a.status !== b.status) return false;
  if (!numEq(a.value, b.value)) return false;
  if (!numEq(a.residual, b.residual)) return false;
  return sameReason(a.reason, b.reason);
}

function numEq(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function sameReason(a: DerivedObject['reason'], b: DerivedObject['reason']): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.code === b.code && a.message === b.message;
}

// ---------- 残差显示（《状态与事务规范》§7；纯下游函数，永不回写） ----------

export function formatResidual(status: Status, residual: number | undefined): string {
  if (status === 'valid') return '0.00';
  if (status === 'invalid' && residual !== undefined) {
    const a = Math.abs(residual);
    return a >= 1e-3 && a < 1e6 ? residual.toPrecision(4) : residual.toExponential(3);
  }
  return '—';
}
