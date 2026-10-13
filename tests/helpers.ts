// 测试辅助：对象取值 + 独立参考实现（教科书公式直译；不得 import 内核实现）
import { expect } from 'vitest';
import type { DerivedObject, Result, SourceState } from '../src/kernel/types';

/** 定义护栏 ①：sst 黄金 AST 结构（《AST操作集规范》§7；实测也在 guard.test 的变异演练中复用） */
export function assertGoldenSst(template: unknown): void {
  expect(template).toEqual({
    op: 'sum',
    scope: { kind: 'all' },
    term: {
      op: 'pow2',
      arg: {
        op: 'sub',
        args: [
          { op: 'valueOf', of: { op: 'var', name: 'o' } },
          { op: 'ref', target: { kind: 'role', role: 'grandMean' } },
        ],
      },
    },
  });
}

/** 定义护栏 ②：sst 的输入集合（观测 + mean:grand，不含 ssw/ssb） */
export function assertSstInputs(inputs: readonly string[]): void {
  expect([...inputs]).toEqual(['mean:grand', 'obs-1', 'obs-2', 'obs-3', 'obs-4', 'obs-5', 'obs-6']);
}

/** 容差比较：abs + rel·|expected| */
export function expectNear(actual: number, expected: number, abs = 1e-6, rel = 1e-9): void {
  const tol = abs + rel * Math.max(Math.abs(actual), Math.abs(expected));
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`期望 ${expected}（容差 ${tol}），实际 ${actual}`);
  }
}

export function obj(result: Result, id: string): DerivedObject {
  const o = result.objects.get(id);
  if (o === undefined) throw new Error(`对象 ${id} 不存在（测试期望其存在）`);
  return o;
}

export function value(result: Result, id: string): number {
  const o = obj(result, id);
  if (o.value === undefined) throw new Error(`对象 ${id} 无值（状态 ${o.status}）`);
  return o.value;
}

export interface NaiveData {
  groups: { id: string; values: number[] }[];
}

export function toNaive(source: SourceState): NaiveData {
  return {
    groups: source.dataset.groups.map((g) => ({
      id: g.id,
      values: source.dataset.observations.filter((o) => o.groupId === g.id).map((o) => o.value),
    })),
  };
}

/** 教科书定义的直接实现：各类平方和与均值（独立于内核 AST 求值路径） */
export function naiveStats(data: NaiveData): { grand: number; ssw: number; ssb: number; sst: number } {
  const all = data.groups.flatMap((g) => g.values);
  const grand = all.reduce((a, b) => a + b, 0) / all.length;
  let ssw = 0;
  let ssb = 0;
  let sst = 0;
  for (const g of data.groups) {
    if (g.values.length === 0) continue;
    const m = g.values.reduce((a, b) => a + b, 0) / g.values.length;
    for (const v of g.values) {
      ssw += (v - m) ** 2;
      sst += (v - grand) ** 2;
    }
    ssb += g.values.length * (m - grand) ** 2;
  }
  return { grand, ssw, ssb, sst };
}
