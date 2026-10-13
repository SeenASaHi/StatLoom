// 公式渲染（《AST操作集规范》§5）：同一 AST 的三种视图（definition / instance / diagnostic）。
// 渲染是纯下游：只读取 AST、绑定与数值；不产生、不修改任何语义。KaTeX 只负责排版；
// 失败降级为纯文本 AST 摘要——降级的是排版，不是语义。

import katex from 'katex';
import type { DerivedObject, Expr, LoopVar, Scope, SourceState } from '../kernel/types';
import { DEFINITIONS, buildSourceIndex, resolveRole, scopeElements, type SourceIndex } from '../kernel/expressions';
import { formatResidual } from '../kernel/compute';
import { fmt } from './scale';

export type RenderMode = 'definition' | 'instance' | 'diagnostic';

export interface RenderCtx {
  mode: RenderMode;
  source: SourceState;
  bindings: Partial<Record<LoopVar, string>>;
  index: SourceIndex;
  lookup: (id: string) => DerivedObject | undefined;
}

/** 短标签：obs-1 → o1；grp-2 → g2 */
export function shortLabel(id: string): string {
  return id.startsWith('obs-') ? `o${id.slice(4)}` : id.startsWith('grp-') ? `g${id.slice(4)}` : id;
}

function texEscape(s: string): string {
  return s.replace(/[\\{}$&#^_%~]/g, (c) => `\\${c}`).replace(/ /g, '\\;');
}

function groupName(source: SourceState, gid: string): string {
  const g = source.dataset.groups.find((x) => x.id === gid);
  return g?.name ?? gid;
}

/** 对象符号（concrete = 实例层：带具体下标；否则定义层：通用下标） */
export function symbolFor(id: string, source: SourceState, concrete: boolean): string {
  if (id === 'mean:grand') return '\\bar{y}';
  if (id.startsWith('mean:')) {
    const g = id.slice(5);
    return concrete ? `\\bar{y}_{\\text{${texEscape(groupName(source, g))}}}` : '\\bar{y}_{g(o)}';
  }
  if (id.startsWith('count:')) {
    const g = id.slice(6);
    return concrete ? `n_{\\text{${texEscape(groupName(source, g))}}}` : 'n_{g}';
  }
  if (id.startsWith('devsq:')) return `e_{${shortLabel(id.slice(6))}}^{2}`;
  if (id.startsWith('dev:')) return `e_{${shortLabel(id.slice(4))}}`;
  if (id.startsWith('gdevsq:')) {
    const g = id.slice(7);
    return concrete ? `d_{\\text{${texEscape(groupName(source, g))}}}^{2}` : 'd_{g}^{2}';
  }
  if (id.startsWith('gdev:')) {
    const g = id.slice(5);
    return concrete ? `d_{\\text{${texEscape(groupName(source, g))}}}` : 'd_{g}';
  }
  if (id === 'ssw') return 'SS_{W}';
  if (id === 'ssb') return 'SS_{B}';
  if (id === 'sst') return 'SS_{T}';
  if (id === 'con:identity') return 'r';
  if (id.startsWith('obs-')) return concrete ? `y_{${shortLabel(id)}}` : 'y_{o}';
  return `\\text{${texEscape(id)}}`;
}

function scopeLatex(scope: Scope, ctx: RenderCtx, generic: boolean): string {
  switch (scope.kind) {
    case 'all':
      return 'o';
    case 'groupOf': {
      const of = scope.of;
      if (!generic && of.op === 'var') {
        const bound = ctx.bindings[of.name];
        if (bound !== undefined) {
          const gid = bound.startsWith('grp-')
            ? bound
            : ctx.index.obsById.get(bound)?.groupId ?? bound;
          return `o \\in \\text{${texEscape(groupName(ctx.source, gid))}}`;
        }
      }
      return of.op === 'var' && of.name === 'g' ? 'o \\in g' : 'o \\in g(o)';
    }
    case 'groupsWithObservations':
      return 'g';
  }
}

function numeric(value: number | undefined, digits = 2): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(digits);
}

/** AST → LaTeX（通用求值器；不读取任何视图状态） */
export function exprToLatex(expr: Expr, ctx: RenderCtx): string {
  const generic = ctx.mode === 'definition' || ctx.mode === 'diagnostic';
  const sub = (e: Expr): string => exprToLatex(e, ctx);
  switch (expr.op) {
    case 'const':
      return fmt(expr.value, 2);
    case 'var':
      return expr.name === 'o' ? 'o' : 'g';
    case 'valueOf': {
      const of = expr.of;
      if (!generic && of.op === 'var') {
        const bound = ctx.bindings[of.name];
        if (bound !== undefined) {
          const obs = ctx.index.obsById.get(bound);
          if (obs !== undefined) return numeric(obs.value) as string;
        }
      }
      if (of.op === 'var' && of.name === 'o') return generic ? 'y_{o}' : 'y_{o}';
      return 'y';
    }
    case 'ref': {
      const target = expr.target;
      const id =
        target.kind === 'id'
          ? target.id
          : resolveRole(target.role, target.of, { index: ctx.index, bindings: ctx.bindings });
      if (!generic) {
        const obj = ctx.lookup(id);
        if (obj !== undefined && obj.status === 'valid' && obj.value !== undefined) {
          return numeric(obj.value) as string;
        }
      }
      return symbolFor(id, ctx.source, !generic);
    }
    case 'count': {
      const scope = scopeLatex(expr.scope, ctx, generic);
      if (!generic) {
        // 实例层：显示计数结果
        try {
          const n = scopeElements(expr.scope, { index: ctx.index, bindings: ctx.bindings }).length;
          return String(n);
        } catch {
          return `n_{${scope}}`;
        }
      }
      return `n_{${scope}}`;
    }
    case 'sum': {
      const scope = scopeLatex(expr.scope, ctx, generic);
      return `\\sum_{${scope}} ${sub(expr.term)}`;
    }
    case 'mean': {
      const scope = scopeLatex(expr.scope, ctx, generic);
      return `\\frac{1}{n}\\sum_{${scope}} ${sub(expr.term)}`;
    }
    case 'add':
      return `${sub(expr.args[0])} + ${sub(expr.args[1])}`;
    case 'sub':
      return `${sub(expr.args[0])} - ${sub(expr.args[1])}`;
    case 'mul':
      return `${sub(expr.args[0])} \\cdot ${sub(expr.args[1])}`;
    case 'pow2':
      return `\\left(${sub(expr.arg)}\\right)^{2}`;
  }
}

function ctxFor(obj: DerivedObject, source: SourceState, lookup: (id: string) => DerivedObject | undefined, mode: RenderMode): RenderCtx {
  return { mode, source, bindings: obj.bindings, index: buildSourceIndex(source), lookup };
}

/** 定义视图：符号式（含左端符号） */
export function definitionLatexOf(obj: DerivedObject, source: SourceState, lookup: (id: string) => DerivedObject | undefined): string {
  const def = DEFINITIONS[obj.defId];
  if (def === undefined) return symbolFor(obj.id, source, true);
  const lhs = symbolFor(obj.id, source, true);
  const rhs = exprToLatex(def.template, ctxFor(obj, source, lookup, 'definition'));
  const suffix =
    obj.class === 'constraint'
      ? ''
      : '';
  return `${lhs} = ${rhs}${suffix}`;
}

/** 实例视图：数值代入式（含左端符号与最终值）；求和节点保持符号式并在检查器给出逐项明细 */
export function instanceLatexOf(obj: DerivedObject, source: SourceState, lookup: (id: string) => DerivedObject | undefined): string {
  const def = DEFINITIONS[obj.defId];
  if (def === undefined) return symbolFor(obj.id, source, true);
  const lhs = symbolFor(obj.id, source, true);
  const rhs = exprToLatex(def.template, ctxFor(obj, source, lookup, 'instance'));
  const raw = obj.class === 'constraint' ? obj.residual : obj.value;
  let tail = '';
  if (obj.class === 'constraint') {
    tail = ` = ${formatResidual(obj.status, obj.residual)}`;
  } else if (obj.status === 'valid' && raw !== undefined) {
    tail = ` = ${raw.toFixed(2)}`;
  }
  return `${lhs} = ${rhs}${tail}`;
}

/** KaTeX 渲染；失败降级为纯文本（排版降级，语义不降级） */
export function renderKatex(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: true, displayMode: false, strict: false, output: 'html' });
  } catch {
    const esc = latex.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
    return `<code>${esc}</code>`;
  }
}

export interface ElementBinding {
  label: string;
  targetId: string;
  value?: number;
}

/** 逐项明细：求和/均值节点在实例层的元素绑定（观测 id → 项值） */
export function elementBindingsOf(obj: DerivedObject, source: SourceState, lookup: (id: string) => DerivedObject | undefined): ElementBinding[] {
  const def = DEFINITIONS[obj.defId];
  if (def === undefined) return [];
  const index = buildSourceIndex(source);
  const out: ElementBinding[] = [];
  const walk = (expr: Expr, bindings: Partial<Record<LoopVar, string>>): void => {
    switch (expr.op) {
      case 'sum':
      case 'mean': {
        const elements = scopeElements(expr.scope, { index, bindings });
        for (const el of elements) {
          const b = el.startsWith('obs-') ? { ...bindings, o: el } : { ...bindings, g: el };
          walk(expr.term, b);
        }
        return;
      }
      case 'ref': {
        const t = expr.target;
        const id =
          t.kind === 'id'
            ? t.id
            : resolveRole(t.role, t.of, { index, bindings });
        const v = lookup(id)?.value;
        out.push({ label: id, targetId: id, value: v });
        return;
      }
      case 'add':
      case 'sub':
      case 'mul':
        walk(expr.args[0], bindings);
        walk(expr.args[1], bindings);
        return;
      case 'pow2':
        walk(expr.arg, bindings);
        return;
      default:
        return;
    }
  };
  walk(def.template, obj.bindings);
  return out;
}
