// 变异演练（《AST操作集规范》§7）：证明结构护栏确实能触发。
// SS_T ≡ SS_W+SS_B 是代数恒等式，数值测试无法区分两种定义；护栏必须是结构的：
// ①黄金 AST 快照 ②依赖集合测试。本文件构造 sst := ssw+ssb 的变异，
// 断言这两条检查在变异下失败（而在真实定义上通过）。

import { describe, expect, it } from 'vitest';
import { benchmarkSource } from '../src/fixtures';
import { DEFINITIONS, buildSourceIndex, deriveRefsAndInputs, evaluateExpr } from '../src/kernel/expressions';
import { rebuild } from '../src/kernel/rebuild';
import type { Expr } from '../src/kernel/types';
import { assertGoldenSst, assertSstInputs } from './helpers';

const MUTATED_SST_TEMPLATE: Expr = {
  op: 'add',
  args: [
    { op: 'ref', target: { kind: 'id', id: 'ssw' } },
    { op: 'ref', target: { kind: 'id', id: 'ssb' } },
  ],
};

const ctx = { index: buildSourceIndex(benchmarkSource()), bindings: {} };

describe('变异演练：sst := ssw + ssb', () => {
  it('真实定义：两条结构护栏均通过', () => {
    assertGoldenSst(DEFINITIONS['def:sst'].template);
    assertSstInputs(deriveRefsAndInputs(DEFINITIONS['def:sst'].template, ctx).inputs);
  });

  it('护栏 ①（黄金 AST）在变异下失败', () => {
    expect(() => assertGoldenSst(MUTATED_SST_TEMPLATE)).toThrow();
  });

  it('护栏 ②（依赖集合）在变异下失败：输入退化为 [ssb, ssw]', () => {
    const { inputs } = deriveRefsAndInputs(MUTATED_SST_TEMPLATE, ctx);
    expect(inputs).toEqual(['ssb', 'ssw']); // 与冻结期望（观测 + mean:grand）不符
    expect(() => assertSstInputs(inputs)).toThrow();
  });

  it('数值路径无法区分（护栏必须结构化的论证）：两种定义在基准数据上同值', () => {
    const r = rebuild(benchmarkSource());
    const index = buildSourceIndex(r.source);
    const env = { index, lookup: (id: string) => r.objects.get(id) };
    const direct = evaluateExpr(DEFINITIONS['def:sst'].template, { index, bindings: {} }, env);
    const mutated = evaluateExpr(MUTATED_SST_TEMPLATE, { index, bindings: {} }, env);
    expect(direct.status).toBe('valid');
    expect(mutated.status).toBe('valid');
    // 代数恒等式：数值测试无法把两种定义分开——所以护栏只能是结构的（①②）。
    expect(mutated.value).toBe(direct.value);
  });
});
