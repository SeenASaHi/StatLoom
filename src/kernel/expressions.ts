// AST 操作集实现（《AST操作集规范》）：定义注册表（数据）、角色解析、作用域物化、
// 引用/输入推导、实例化、通用求值器。数学语义唯一来源——没有按 kind 分支的手写计算。

import type {
  DerivedObject,
  Draft,
  EvalOutcome,
  Expr,
  ExprDefinition,
  LoopVar,
  ObjectReason,
  Observation,
  RefTarget,
  RoleName,
  Scope,
  SourceState,
  Status,
} from './types';
import { KernelError } from './errors';

// ---------- 定义注册表（数据；《AST操作集规范》§4 冻结的 11 条） ----------

const role = (r: RoleName, of?: Expr): Expr => ({ op: 'ref', target: of === undefined ? { kind: 'role', role: r } : { kind: 'role', role: r, of } });
const idRef = (id: string): Expr => ({ op: 'ref', target: { kind: 'id', id } });
const v = (name: LoopVar): Expr => ({ op: 'var', name });
const valueOf = (name: LoopVar): Expr => ({ op: 'valueOf', of: v(name) });

export const DEFINITIONS: Record<string, ExprDefinition> = {
  'def:count': {
    defId: 'def:count', class: 'statistic', statisticKind: 'count', ruleVersion: 1, freeVars: ['g'],
    template: { op: 'count', scope: { kind: 'groupOf', of: v('g') } },
  },
  'def:meanGroup': {
    defId: 'def:meanGroup', class: 'statistic', statisticKind: 'mean', ruleVersion: 1, freeVars: ['g'],
    template: { op: 'mean', scope: { kind: 'groupOf', of: v('g') }, term: valueOf('o') },
  },
  'def:meanGrand': {
    defId: 'def:meanGrand', class: 'statistic', statisticKind: 'mean', ruleVersion: 1, freeVars: [],
    template: { op: 'mean', scope: { kind: 'all' }, term: valueOf('o') },
  },
  'def:deviation': {
    defId: 'def:deviation', class: 'statistic', statisticKind: 'deviation', ruleVersion: 1, freeVars: ['o'],
    template: { op: 'sub', args: [valueOf('o'), role('groupMean', v('o'))] },
  },
  'def:devSq': {
    defId: 'def:devSq', class: 'statistic', statisticKind: 'squaredDeviation', ruleVersion: 1, freeVars: ['o'],
    template: { op: 'pow2', arg: role('deviation', v('o')) },
  },
  'def:gdev': {
    defId: 'def:gdev', class: 'statistic', statisticKind: 'groupMeanDeviation', ruleVersion: 1, freeVars: ['g'],
    template: { op: 'sub', args: [role('groupMean', v('g')), role('grandMean')] },
  },
  'def:gdevSq': {
    defId: 'def:gdevSq', class: 'statistic', statisticKind: 'squaredGroupMeanDeviation', ruleVersion: 1, freeVars: ['g'],
    template: { op: 'pow2', arg: role('groupMeanDeviation', v('g')) },
  },
  'def:ssw': {
    defId: 'def:ssw', class: 'statistic', statisticKind: 'ssWithin', ruleVersion: 1, freeVars: [],
    template: { op: 'sum', scope: { kind: 'all' }, term: role('squaredDeviation', v('o')) },
  },
  'def:ssb': {
    defId: 'def:ssb', class: 'statistic', statisticKind: 'ssBetween', ruleVersion: 1, freeVars: [],
    template: {
      op: 'sum',
      scope: { kind: 'groupsWithObservations' },
      term: { op: 'mul', args: [role('groupCount', v('g')), role('squaredGroupMeanDeviation', v('g'))] },
    },
  },
  'def:sst': {
    defId: 'def:sst', class: 'statistic', statisticKind: 'ssTotal', ruleVersion: 1, freeVars: [],
    template: { op: 'sum', scope: { kind: 'all' }, term: { op: 'pow2', arg: { op: 'sub', args: [valueOf('o'), role('grandMean')] } } },
  },
  'def:identity': {
    defId: 'def:identity', class: 'constraint', ruleVersion: 1, freeVars: [],
    template: { op: 'sub', args: [idRef('sst'), { op: 'add', args: [idRef('ssw'), idRef('ssb')] }] },
  },
};

// ---------- 对象 id 构造（确定性身份，非名称；设计文档 §4.2） ----------

export const grandMeanId = 'mean:grand';
export const ssWithinId = 'ssw';
export const ssBetweenId = 'ssb';
export const ssTotalId = 'sst';
export const identityId = 'con:identity';
export const countId = (gid: string): string => `count:${gid}`;
export const meanId = (gid: string): string => `mean:${gid}`;
export const deviationId = (oid: string): string => `dev:${oid}`;
export const devSqId = (oid: string): string => `devsq:${oid}`;
export const gdevId = (gid: string): string => `gdev:${gid}`;
export const gdevSqId = (gid: string): string => `gdevsq:${gid}`;

// ---------- 源索引（作用域物化与引用解析用；每次重建构建一次） ----------

export interface SourceIndex {
  obsById: Map<string, Observation>;
  /** 组的观测（按源数组稳定序） */
  obsByGroup: Map<string, Observation[]>;
  /** 组 id（按源数组序） */
  groupIdsInOrder: string[];
}

export function buildSourceIndex(source: SourceState): SourceIndex {
  const obsById = new Map<string, Observation>();
  const obsByGroup = new Map<string, Observation[]>();
  for (const g of source.dataset.groups) obsByGroup.set(g.id, []);
  for (const o of source.dataset.observations) {
    obsById.set(o.id, o);
    const list = obsByGroup.get(o.groupId);
    if (list === undefined) {
      throw new KernelError(`观测 ${o.id} 引用了不存在的组 ${o.groupId}（源状态违反引用完整性）`);
    }
    list.push(o);
  }
  return { obsById, obsByGroup, groupIdsInOrder: source.dataset.groups.map((g) => g.id) };
}

export interface BindingContext {
  index: SourceIndex;
  bindings: Partial<Record<LoopVar, string>>;
}

/** 求值/推导的公共上下文：把 `of` 表达式解析为观测 id */
function obsIdOf(expr: Expr, ctx: BindingContext): string {
  const id = bindingRefId(expr, ctx);
  if (id.startsWith('obs-')) return id;
  if (id.startsWith('grp-')) {
    throw new KernelError(`此处需要观测引用，但绑定到组 ${id}（定义缺陷）`);
  }
  throw new KernelError(`无法解析为观测引用：${id}`);
}

/** 解析为组 id（可来自组绑定或观测绑定） */
function groupIdOf(expr: Expr, ctx: BindingContext): string {
  const id = bindingRefId(expr, ctx);
  if (id.startsWith('grp-')) return id;
  if (id.startsWith('obs-')) {
    const obs = ctx.index.obsById.get(id);
    if (obs === undefined) throw new KernelError(`观测 ${id} 不存在（源状态违反引用完整性）`);
    return obs.groupId;
  }
  throw new KernelError(`无法解析为组引用：${id}`);
}

function bindingRefId(expr: Expr, ctx: BindingContext): string {
  if (expr.op !== 'var') throw new KernelError(`引用参数仅支持 var 节点，收到 ${expr.op}（定义缺陷）`);
  const id = ctx.bindings[expr.name];
  if (id === undefined) throw new KernelError(`自由变量 ${expr.name} 未绑定（定义缺陷）`);
  return id;
}

// ---------- 角色解析表（《AST操作集规范》§3） ----------

export function resolveRole(roleName: RoleName, of: Expr | undefined, ctx: BindingContext): string {
  switch (roleName) {
    case 'grandMean': return grandMeanId;
    case 'ssWithin': return ssWithinId;
    case 'ssBetween': return ssBetweenId;
    case 'ssTotal': return ssTotalId;
    case 'groupCount':
    case 'groupMean': {
      const gid = groupIdOf(requireOf(roleName, of), ctx);
      return roleName === 'groupCount' ? countId(gid) : meanId(gid);
    }
    case 'deviation':
    case 'squaredDeviation': {
      const oid = obsIdOf(requireOf(roleName, of), ctx);
      return roleName === 'deviation' ? deviationId(oid) : devSqId(oid);
    }
    case 'groupMeanDeviation':
    case 'squaredGroupMeanDeviation': {
      const gid = groupIdOf(requireOf(roleName, of), ctx);
      return roleName === 'groupMeanDeviation' ? gdevId(gid) : gdevSqId(gid);
    }
  }
}

function requireOf(roleName: RoleName, of: Expr | undefined): Expr {
  if (of === undefined) throw new KernelError(`角色 ${roleName} 缺少 of 参数（定义缺陷）`);
  return of;
}

// ---------- 作用域物化（稳定序＝源数组序） ----------

/** 作用域元素 id：all/groupOf → 观测 id；groupsWithObservations → 有观测的组 id */
export function scopeElements(scope: Scope, ctx: BindingContext): string[] {
  switch (scope.kind) {
    case 'all':
      return [...ctx.index.obsById.keys()];
    case 'groupOf': {
      const gid = groupIdOf(scope.of, ctx);
      return (ctx.index.obsByGroup.get(gid) ?? []).map((o) => o.id);
    }
    case 'groupsWithObservations':
      return ctx.index.groupIdsInOrder.filter((gid) => (ctx.index.obsByGroup.get(gid)?.length ?? 0) > 0);
  }
}

/**
 * 作用域成员的观测 id（输入记录用；《统一依赖图规范》§2）：
 * all → 全部观测；groupOf → 该组观测；groupsWithObservations → 各非空组的全部观测。
 * 注意与 scopeElements 的区别：后者的元素可能是"组"（迭代绑定 g 用）。
 */
export function scopeMemberObservations(scope: Scope, ctx: BindingContext): string[] {
  switch (scope.kind) {
    case 'all':
      return [...ctx.index.obsById.keys()];
    case 'groupOf': {
      const gid = groupIdOf(scope.of, ctx);
      return (ctx.index.obsByGroup.get(gid) ?? []).map((o) => o.id);
    }
    case 'groupsWithObservations': {
      const out: string[] = [];
      for (const gid of ctx.index.groupIdsInOrder) {
        for (const o of ctx.index.obsByGroup.get(gid) ?? []) out.push(o.id);
      }
      return out;
    }
  }
}

// ---------- 引用与输入推导（《统一依赖图规范》§2） ----------

export interface DerivedRefs {
  /** 角色（或 id 形式）→ 对象 id；实例引用表 */
  refs: Record<string, string>;
  /** 排序去重后的输入 id 集 = 读到的全部对象（refs ∪ 作用域成员 ∪ valueOf 观测） */
  inputs: string[];
}

/**
 * 遍历模板推导输入集合。收集规则 = 求值期读取规则：
 * - `ref` 节点 → 解析出的对象（**静态引用与作用域是否为空无关**）；
 * - `valueOf` → 被读的观测；
 * - 作用域节点 → 作用域成员观测全体（结构依赖），并以循环变量绑定逐元素递归 term。
 * 宽松解析：引用依赖的循环变量尚未绑定时跳过（作用域迭代/外层迭代会再次进入），
 * 其余解析失败照常抛错（定义缺陷）。
 */
export function deriveRefsAndInputs(template: Expr, ctx: BindingContext): DerivedRefs {
  const refs: Record<string, string> = {};
  const inputSet = new Set<string>();

  const recordRef = (key: string, id: string): void => {
    inputSet.add(id);
    if (!(key in refs)) refs[key] = id; // 首个解析样例（静态优先）
  };

  const tryResolve = (target: RefTarget, bind: Partial<Record<LoopVar, string>>): string | undefined => {
    if (target.kind === 'id') return target.id;
    if (target.of !== undefined && target.of.op === 'var' && bind[target.of.name] === undefined) {
      return undefined;
    }
    return resolveRole(target.role, target.of, { index: ctx.index, bindings: bind });
  };

  const walk = (node: Expr, bind: Partial<Record<LoopVar, string>>): void => {
    const c: BindingContext = { index: ctx.index, bindings: bind };
    switch (node.op) {
      case 'const':
      case 'var':
        return;
      case 'valueOf': {
        if (node.of.op === 'var' && bind[node.of.name] === undefined) return;
        inputSet.add(obsIdOf(node.of, c));
        return;
      }
      case 'ref': {
        const id = tryResolve(node.target, bind);
        if (id === undefined) return;
        recordRef(node.target.kind === 'id' ? `id:${id}` : node.target.role, id);
        return;
      }
      case 'count': {
        for (const m of scopeMemberObservations(node.scope, c)) inputSet.add(m);
        return;
      }
      case 'sum':
      case 'mean': {
        let elements: string[] = [];
        try {
          elements = scopeElements(node.scope, c);
          for (const m of scopeMemberObservations(node.scope, c)) inputSet.add(m);
        } catch {
          elements = []; // 作用域依赖的循环变量未绑定——由外层迭代重新进入
        }
        walk(node.term, bind); // 静态引用：与作用域是否为空无关
        for (const el of elements) {
          walk(node.term, withElementBinding(bind, el));
        }
        return;
      }
      case 'add':
      case 'sub':
      case 'mul':
        walk(node.args[0], bind);
        walk(node.args[1], bind);
        return;
      case 'pow2':
        walk(node.arg, bind);
        return;
    }
  };

  walk(template, ctx.bindings);
  return { refs, inputs: [...inputSet].sort() };
}

function withElementBinding(bind: Partial<Record<LoopVar, string>>, elementId: string): Partial<Record<LoopVar, string>> {
  if (elementId.startsWith('obs-')) return { ...bind, o: elementId };
  if (elementId.startsWith('grp-')) return { ...bind, g: elementId };
  throw new KernelError(`作用域元素 id 前缀非法：${elementId}`);
}

// ---------- 实例化（期望派生集合；《AST操作集规范》§1） ----------

export function instantiateAll(source: SourceState): Map<string, Draft> {
  const index = buildSourceIndex(source);
  const out = new Map<string, Draft>();

  const add = (id: string, defId: string, bindings: Partial<Record<LoopVar, string>>): void => {
    const def = DEFINITIONS[defId];
    if (def === undefined) throw new KernelError(`未注册的定义 ${defId}`);
    const { refs, inputs } = deriveRefsAndInputs(def.template, { index, bindings });
    out.set(id, { id, defId, class: def.class, bindings, refs, inputs });
  };

  for (const g of source.dataset.groups) {
    add(countId(g.id), 'def:count', { g: g.id });
    add(meanId(g.id), 'def:meanGroup', { g: g.id });
    add(gdevId(g.id), 'def:gdev', { g: g.id });
    add(gdevSqId(g.id), 'def:gdevSq', { g: g.id });
  }
  add(grandMeanId, 'def:meanGrand', {});
  for (const o of source.dataset.observations) {
    add(deviationId(o.id), 'def:deviation', { o: o.id });
    add(devSqId(o.id), 'def:devSq', { o: o.id });
  }
  add(ssWithinId, 'def:ssw', {});
  add(ssBetweenId, 'def:ssb', {});
  add(ssTotalId, 'def:sst', {});
  add(identityId, 'def:identity', {});
  return out;
}

// ---------- 通用求值器（值模式；《AST操作集规范》§2 求值规则） ----------

export interface EvalEnv {
  index: SourceIndex;
  /** 查已求值对象（拓扑序保证依赖先于被依赖者落定） */
  lookup: (id: string) => DerivedObject | undefined;
}

const SEVERITY: Record<Status, number> = { valid: 0, pending: 0, undefined: 1, invalid: 2, error: 3 };

function propagate(parts: { id: string; status: Status }[]): EvalOutcome {
  let worst: Status = 'undefined';
  for (const p of parts) {
    if (SEVERITY[p.status] > SEVERITY[worst]) worst = p.status;
  }
  const ids = parts.map((p) => p.id);
  const reason: ObjectReason = {
    code: 'input-not-valid',
    message: `输入未就绪：${parts.map((p) => `${p.id}（${p.status}）`).join('、')}`,
    inputs: ids,
  };
  return { status: worst, reason };
}

function checkFinite(value: number, what: string): EvalOutcome {
  if (!Number.isFinite(value)) {
    return { status: 'error', reason: { code: 'non-finite-result', message: `${what} 结果非有限（数值溢出或非法运算）` } };
  }
  return { status: 'valid', value };
}

/**
 * 收集可在给定绑定下静态解析的引用 id（宽松：循环变量未绑定的引用跳过；
 * valueOf 读取的是观测——源对象恒 valid，不参与状态传播）。
 */
export function collectStaticRefIds(node: Expr, bind: Partial<Record<LoopVar, string>>, index: SourceIndex): string[] {
  const out: string[] = [];
  const walk = (n: Expr): void => {
    switch (n.op) {
      case 'ref': {
        const t = n.target;
        if (t.kind === 'id') {
          out.push(t.id);
          return;
        }
        if (t.of !== undefined && t.of.op === 'var' && bind[t.of.name] === undefined) return;
        out.push(resolveRole(t.role, t.of, { index, bindings: bind }));
        return;
      }
      case 'sum':
      case 'mean':
        walk(n.term);
        return;
      case 'add':
      case 'sub':
      case 'mul':
        walk(n.args[0]);
        walk(n.args[1]);
        return;
      case 'pow2':
        walk(n.arg);
        return;
      default:
        return;
    }
  };
  walk(node);
  return out;
}

export function evaluateExpr(expr: Expr, ctx: BindingContext, env: EvalEnv): EvalOutcome {
  const c: BindingContext = { index: env.index, bindings: ctx.bindings };
  switch (expr.op) {
    case 'const':
      return checkFinite(expr.value, '常量');
    case 'var':
      throw new KernelError('var 节点不能出现在取值位置（定义缺陷）');
    case 'valueOf': {
      const oid = obsIdOf(expr.of, c);
      const obs = env.index.obsById.get(oid);
      if (obs === undefined) throw new KernelError(`观测 ${oid} 不存在`);
      return { status: 'valid', value: obs.value };
    }
    case 'ref': {
      const target = expr.target;
      const id = target.kind === 'id' ? target.id : resolveRole(target.role, target.of, c);
      const obj = env.lookup(id);
      if (obj === undefined) throw new KernelError(`引用的对象 ${id} 不存在于本批次（内核缺陷）`);
      if (obj.status !== 'valid') return propagate([{ id, status: obj.status }]);
      if (obj.value === undefined) throw new KernelError(`对象 ${id} 状态 valid 但无值（内核缺陷）`);
      return { status: 'valid', value: obj.value };
    }
    case 'count': {
      return { status: 'valid', value: scopeElements(expr.scope, c).length };
    }
    case 'sum':
    case 'mean': {
      // 静态引用预检（与作用域是否为空无关）：先让不依赖循环变量的引用传播状态
      for (const id of collectStaticRefIds(expr.term, c.bindings, env.index)) {
        const obj = env.lookup(id);
        if (obj === undefined) throw new KernelError(`引用的对象 ${id} 不存在于本批次（内核缺陷）`);
        if (obj.status !== 'valid') return propagate([{ id, status: obj.status }]);
      }
      const elements = scopeElements(expr.scope, c);
      if (elements.length === 0) {
        const label = expr.op === 'sum' ? '求和' : '均值';
        return {
          status: 'undefined',
          reason: { code: 'empty-scope', message: `空作用域：${label}在空集合上未定义` },
        };
      }
      let acc = 0;
      for (const el of elements) {
        const r = evaluateExpr(expr.term, { index: env.index, bindings: withElementBinding(c.bindings, el) }, env);
        if (r.status !== 'valid') return r;
        acc += r.value as number;
      }
      if (expr.op === 'mean') acc = acc / elements.length;
      return checkFinite(acc, expr.op === 'sum' ? '求和' : '均值');
    }
    case 'pow2': {
      const r = evaluateExpr(expr.arg, c, env);
      if (r.status !== 'valid') return r;
      return checkFinite((r.value as number) ** 2, '平方');
    }
    case 'add':
    case 'sub':
    case 'mul': {
      const a = evaluateExpr(expr.args[0], c, env);
      if (a.status !== 'valid') return a;
      const b = evaluateExpr(expr.args[1], c, env);
      if (b.status !== 'valid') return b;
      const x = a.value as number;
      const y = b.value as number;
      const value = expr.op === 'add' ? x + y : expr.op === 'sub' ? x - y : x * y;
      return checkFinite(value, expr.op === 'add' ? '加法' : expr.op === 'sub' ? '减法' : '乘法');
    }
  }
}
