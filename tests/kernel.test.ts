// 内核测试 Ⅰ：参考值（验收用例 A）、边界矩阵、黄金 AST、依赖推导
import { describe, expect, it } from 'vitest';
import { benchmarkSource, emptySource } from '../src/fixtures';
import { DEFINITIONS } from '../src/kernel/expressions';
import { formatResidual, identityThreshold } from '../src/kernel/compute';
import { rebuild } from '../src/kernel/rebuild';
import type { SourceState } from '../src/kernel/types';
import { assertGoldenSst, assertSstInputs, naiveStats, obj, toNaive, value } from './helpers';

function clone(s: SourceState): SourceState {
  return structuredClone(s);
}

describe('参考值：验收用例 A（A=[4,5,6] B=[7,8,9]）', () => {
  const r = rebuild(benchmarkSource());

  it('均值：组 5 / 8，总体 6.5', () => {
    expect(value(r, 'mean:grp-1')).toBeCloseTo(5, 9);
    expect(value(r, 'mean:grp-2')).toBeCloseTo(8, 9);
    expect(value(r, 'mean:grand')).toBeCloseTo(6.5, 9);
  });

  it('平方和：SS_W=4、SS_B=13.5、SS_T=17.5，残差精确为 0', () => {
    expect(value(r, 'ssw')).toBeCloseTo(4, 9);
    expect(value(r, 'ssb')).toBeCloseTo(13.5, 9);
    expect(value(r, 'sst')).toBeCloseTo(17.5, 9);
    expect(obj(r, 'con:identity').status).toBe('valid');
    expect(obj(r, 'con:identity').residual).toBe(0); // 基准数据全部可精确表示
  });

  it('与独立参考实现一致（全部派生数值）', () => {
    const naive = naiveStats(toNaive(benchmarkSource()));
    expect(value(r, 'mean:grand')).toBeCloseTo(naive.grand, 9);
    expect(value(r, 'ssw')).toBeCloseTo(naive.ssw, 9);
    expect(value(r, 'ssb')).toBeCloseTo(naive.ssb, 9);
    expect(value(r, 'sst')).toBeCloseTo(naive.sst, 9);
  });

  it('对象级细节：count / deviation / squaredDeviation / gdev', () => {
    expect(value(r, 'count:grp-1')).toBe(3);
    expect(value(r, 'dev:obs-1')).toBeCloseTo(-1, 9); // 4 − 5
    expect(value(r, 'devsq:obs-1')).toBeCloseTo(1, 9);
    expect(value(r, 'gdev:grp-1')).toBeCloseTo(-1.5, 9); // 5 − 6.5
    expect(value(r, 'gdevsq:grp-2')).toBeCloseTo(2.25, 9); // (8 − 6.5)²
  });

  it('基准数据全体对象 valid', () => {
    for (const [id, o] of r.objects) {
      expect(o.status, `对象 ${id}`).toBe('valid');
    }
  });
});

describe('边界矩阵（《状态与事务规范》§8）', () => {
  it('空数据集：均值/平方和 undefined 带理由，恒等式不可求值（≠ 已验证 ≠ 被违反）', () => {
    const r = rebuild(emptySource());
    expect(obj(r, 'mean:grand').status).toBe('undefined');
    expect(obj(r, 'mean:grand').reason?.code).toBe('empty-scope');
    expect(obj(r, 'ssw').status).toBe('undefined');
    expect(obj(r, 'ssw').reason?.code).toBe('empty-scope');
    expect(obj(r, 'ssb').status).toBe('undefined');
    // sst 经静态引用传播：理由指向未定义的 mean:grand（而非空作用域）
    expect(obj(r, 'sst').status).toBe('undefined');
    expect(obj(r, 'sst').reason?.code).toBe('input-not-valid');
    expect(obj(r, 'sst').reason?.inputs).toContain('mean:grand');
    expect(obj(r, 'con:identity').status).toBe('undefined');
    expect(obj(r, 'con:identity').reason?.code).toBe('input-not-valid');
  });

  it('空组：组保留、count=0（valid）、组均值 undefined、ssW/ssB 不受影响', () => {
    const s = clone(benchmarkSource());
    s.idCounter = 7;
    s.dataset.groups.push({ id: 'grp-3', version: 1, name: 'C' });
    const r = rebuild(s);
    expect(value(r, 'count:grp-3')).toBe(0);
    expect(obj(r, 'mean:grp-3').status).toBe('undefined');
    expect(obj(r, 'mean:grp-3').reason?.code).toBe('empty-scope');
    expect(obj(r, 'gdev:grp-3').status).toBe('undefined'); // 传播
    expect(value(r, 'ssw')).toBeCloseTo(4, 9);
    expect(value(r, 'ssb')).toBeCloseTo(13.5, 9); // 空组被显式排除
  });

  it('单点组与删除观测：与独立参考实现一致', () => {
    const s = clone(benchmarkSource());
    s.dataset.observations = s.dataset.observations.filter((o) => o.id !== 'obs-2' && o.id !== 'obs-3');
    const r = rebuild(s);
    const naive = naiveStats(toNaive(s));
    expect(value(r, 'mean:grp-1')).toBeCloseTo(4, 9);
    expect(value(r, 'dev:obs-1')).toBe(0); // 单点组：偏差 0
    expect(value(r, 'ssw')).toBeCloseTo(naive.ssw, 9);
    expect(value(r, 'ssb')).toBeCloseTo(naive.ssb, 9);
    expect(value(r, 'sst')).toBeCloseTo(naive.sst, 9);
  });

  it('全部观测值相同：平方和全为 0（valid），无除零产物', () => {
    const s = clone(benchmarkSource());
    for (const o of s.dataset.observations) o.value = 7;
    const r = rebuild(s);
    expect(value(r, 'sst')).toBe(0);
    expect(value(r, 'ssw')).toBe(0);
    expect(value(r, 'ssb')).toBe(0);
    expect(obj(r, 'con:identity').status).toBe('valid');
  });

  it('仅一个非空组：SS_B = 0 且 SS_T = SS_W', () => {
    const s = clone(benchmarkSource());
    s.dataset.observations = s.dataset.observations.filter((o) => o.groupId === 'grp-1');
    const r = rebuild(s);
    expect(value(r, 'ssb')).toBe(0);
    expect(value(r, 'sst')).toBeCloseTo(value(r, 'ssw'), 9);
  });
});

describe('定义护栏：黄金 AST（结构判定；《AST操作集规范》§7）', () => {
  it('恰有 11 条冻结定义', () => {
    expect(Object.keys(DEFINITIONS).sort()).toEqual(
      ['def:count', 'def:devSq', 'def:deviation', 'def:gdev', 'def:gdevSq', 'def:identity', 'def:meanGrand', 'def:meanGroup', 'def:ssb', 'def:sst', 'def:ssw'].sort(),
    );
  });

  it('sst 的结构冻结：独立定义（Σ(yᵢ−ȳ)²），不得写成 ssw+ssb 的合式', () => {
    assertGoldenSst(DEFINITIONS['def:sst'].template);
  });

  it('identity 的结构冻结：sst − (ssw + ssb)', () => {
    expect(DEFINITIONS['def:identity'].template).toEqual({
      op: 'sub',
      args: [
        { op: 'ref', target: { kind: 'id', id: 'sst' } },
        {
          op: 'add',
          args: [
            { op: 'ref', target: { kind: 'id', id: 'ssw' } },
            { op: 'ref', target: { kind: 'id', id: 'ssb' } },
          ],
        },
      ],
    });
  });
});

describe('依赖推导（《统一依赖图规范》§2）', () => {
  it('sst 的输入 = 观测 + mean:grand，且不含 ssw / ssb', () => {
    const r = rebuild(benchmarkSource());
    assertSstInputs(obj(r, 'sst').inputs);
    expect(obj(r, 'sst').inputs).not.toContain('ssw');
    expect(obj(r, 'sst').inputs).not.toContain('ssb');
  });

  it('dev:obs-1 的输入 = 自身观测 + 其组均值', () => {
    const r = rebuild(benchmarkSource());
    expect(obj(r, 'dev:obs-1').inputs).toEqual(['mean:grp-1', 'obs-1']);
  });

  it('ssb 的输入含 count/gdevsq 与全部观测（不含空组相关对象）', () => {
    const r = rebuild(benchmarkSource());
    expect(obj(r, 'ssb').inputs).toEqual([
      'count:grp-1', 'count:grp-2', 'gdevsq:grp-1', 'gdevsq:grp-2',
      'obs-1', 'obs-2', 'obs-3', 'obs-4', 'obs-5', 'obs-6',
    ]);
  });

  it('con:identity 的输入 = [ssb, sst, ssw]（字典序）', () => {
    const r = rebuild(benchmarkSource());
    expect(obj(r, 'con:identity').inputs).toEqual(['ssb', 'sst', 'ssw']);
  });

  it('空数据集下 sst 仍依赖 mean:grand（静态引用无条件计入）', () => {
    const r = rebuild(emptySource());
    expect(obj(r, 'sst').inputs).toEqual(['mean:grand']);
  });
});

describe('容差与残差显示（《状态与事务规范》§7）', () => {
  it('阈值公式：atol + rtol·max(|ssT|,|ssW|,|ssB|,1)', () => {
    expect(identityThreshold(4, 13.5, 17.5)).toBeCloseTo(1e-9 + 1e-9 * 17.5, 18);
    expect(identityThreshold(0, 0, 0)).toBeCloseTo(2e-9, 18);
  });

  it('显示算法：valid→0.00；invalid→足位有效数字；undefined→—', () => {
    expect(formatResidual('valid', 0)).toBe('0.00');
    expect(formatResidual('invalid', 0.004)).toBe('0.004000');
    expect(formatResidual('invalid', 1.2e7)).toBe('1.200e+7');
    expect(formatResidual('invalid', 1.2e-8)).toBe('1.200e-8');
    expect(formatResidual('undefined', undefined)).toBe('—');
    expect(formatResidual('error', undefined)).toBe('—');
  });
});
