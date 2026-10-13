// 内核测试 Ⅱ：精确受影响集合、无关对象五不变、实例化差异、环检测、审计
import { describe, expect, it } from 'vitest';
import { benchmarkSource } from '../src/fixtures';
import { topologicalOrder, audit, affectedFrom } from '../src/kernel/graph';
import { KernelCycleError } from '../src/kernel/errors';
import { rebuild } from '../src/kernel/rebuild';
import type { DerivedObject, Result, SourceState } from '../src/kernel/types';
import { obj, value } from './helpers';

function clone(s: SourceState): SourceState {
  return structuredClone(s);
}

/** 改动观测值：值 + 版本 + 数据集 revision（模拟一次已提交命令的源状态效果） */
function commitValue(s: SourceState, obsId: string, v: number): SourceState {
  const next = clone(s);
  const o = next.dataset.observations.find((x) => x.id === obsId);
  if (o === undefined) throw new Error('no obs');
  o.value = v;
  o.version += 1;
  next.dataset.revision += 1;
  return next;
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

describe('精确受影响集合（用例 C：改 A 组 r01 的值 4 → 9.5，总体均值随之变化）', () => {
  const s0 = benchmarkSource();
  const r0 = rebuild(s0);
  const s1 = commitValue(s0, 'obs-1', 9.5);
  const r1 = rebuild(s1, r0.objects);

  it('重算集合 = 精确的 17 个对象（含 B 组 gdev 链，不含 B 组观测偏差链）', () => {
    expect(sorted(r1.changedObjectIds)).toEqual(
      sorted([
        // A 组链
        'count:grp-1', 'mean:grp-1', 'gdev:grp-1', 'gdevsq:grp-1',
        'dev:obs-1', 'dev:obs-2', 'dev:obs-3',
        'devsq:obs-1', 'devsq:obs-2', 'devsq:obs-3',
        // 总体均值链
        'mean:grand', 'gdev:grp-2', 'gdevsq:grp-2',
        // 汇总与约束
        'ssw', 'ssb', 'sst', 'con:identity',
      ]),
    );
  });

  it('无关对象五不变：B 组观测链的实例引用完全相同（身份不变量）', () => {
    for (const id of ['count:grp-2', 'mean:grp-2', 'dev:obs-4', 'devsq:obs-4', 'dev:obs-5', 'devsq:obs-5', 'dev:obs-6', 'devsq:obs-6']) {
      expect(r1.objects.get(id), `对象 ${id} 应复用同一实例`).toBe(r0.objects.get(id));
    }
  });

  it('受影响对象的数值正确（与内联手算一致）', () => {
    expect(value(r1, 'mean:grp-1')).toBeCloseTo((9.5 + 5 + 6) / 3, 9);
    expect(value(r1, 'mean:grand')).toBeCloseTo((9.5 + 5 + 6 + 7 + 8 + 9) / 6, 9);
    expect(value(r1, 'dev:obs-1')).toBeCloseTo(9.5 - (9.5 + 5 + 6) / 3, 9);
    expect(value(r1, 'gdev:grp-2')).toBeCloseTo(8 - (9.5 + 5 + 6 + 7 + 8 + 9) / 6, 9);
    expect(obj(r1, 'con:identity').status).toBe('valid');
  });
});

describe('精确受影响集合（换组：obs-1 由 A 移入 B，总体均值不变而组均值改变）', () => {
  const s0 = benchmarkSource();
  const r0 = rebuild(s0);
  const s1 = clone(s0);
  const o = s1.dataset.observations.find((x) => x.id === 'obs-1');
  if (o === undefined) throw new Error('no obs');
  o.groupId = 'grp-2';
  o.version += 1;
  s1.dataset.revision += 1;
  const r1 = rebuild(s1, r0.objects);

  it('总体均值数值不变且版本不变（重算但内容相同 → version 不递增）', () => {
    expect(value(r1, 'mean:grand')).toBeCloseTo(value(r0, 'mean:grand'), 9);
    expect(obj(r1, 'mean:grand').version).toBe(obj(r0, 'mean:grand').version);
  });

  it('组均值改变：A=(5+6)/2、B=(4+7+8+9)/4，B 组偏差链随之更新', () => {
    expect(value(r1, 'mean:grp-1')).toBeCloseTo(5.5, 9);
    expect(value(r1, 'mean:grp-2')).toBeCloseTo(7, 9);
    expect(value(r1, 'dev:obs-4')).toBeCloseTo(7 - 7, 9); // 原为 −1
    expect(value(r1, 'gdev:grp-2')).toBeCloseTo(7 - 6.5, 9); // 原为 1.5
    expect(obj(r1, 'con:identity').status).toBe('valid');
  });

  it('B 组内部偏差链确实进入重算集合（经组均值，而非经总体均值）', () => {
    const changed = new Set(r1.changedObjectIds);
    expect(changed.has('dev:obs-4')).toBe(true);
    expect(changed.has('devsq:obs-6')).toBe(true);
  });
});

describe('版本规则（《统一依赖图规范》§3）', () => {
  it('输入版本递增但结果内容相同：对象被重算但 version 不变', () => {
    const s0 = benchmarkSource();
    const r0 = rebuild(s0);
    const s1 = clone(s0);
    const o = s1.dataset.observations.find((x) => x.id === 'obs-1');
    if (o === undefined) throw new Error('no obs');
    o.version += 1; // 版本变化，值不变
    const r1 = rebuild(s1, r0.objects);
    expect(obj(r1, 'dev:obs-1').value).toBe(obj(r0, 'dev:obs-1').value);
    expect(obj(r1, 'dev:obs-1').version).toBe(obj(r0, 'dev:obs-1').version);
    expect(r1.changedObjectIds).toContain('dev:obs-1'); // 重算了，但内容未变
  });

  it('内容变化：version 递增', () => {
    const s0 = benchmarkSource();
    const r0 = rebuild(s0);
    const r1 = rebuild(commitValue(s0, 'obs-1', 9.5), r0.objects);
    expect(obj(r1, 'dev:obs-1').version).toBe(obj(r0, 'dev:obs-1').version + 1);
  });
});

describe('实例化差异（增删观测与组）', () => {
  it('新增观测：新派生对象出现（dev/devsq），汇总链更新', () => {
    const s0 = benchmarkSource();
    const r0 = rebuild(s0);
    const s1 = clone(s0);
    s1.idCounter = 7;
    s1.dataset.revision += 1;
    s1.dataset.observations.push({ id: 'obs-7', version: 1, groupId: 'grp-1', value: 10 });
    const r1 = rebuild(s1, r0.objects);
    expect(r1.objects.size).toBe(r0.objects.size + 2);
    expect(r1.objects.has('dev:obs-7')).toBe(true);
    expect(r1.changedObjectIds).toContain('dev:obs-7');
    expect(value(r1, 'count:grp-1')).toBe(4);
    expect(obj(r1, 'con:identity').status).toBe('valid');
  });

  it('删除观测：对应派生对象被移除', () => {
    const s0 = benchmarkSource();
    const r0 = rebuild(s0);
    const s1 = clone(s0);
    s1.dataset.revision += 1;
    s1.dataset.observations = s1.dataset.observations.filter((x) => x.id !== 'obs-1');
    const r1 = rebuild(s1, r0.objects);
    expect(r1.objects.has('dev:obs-1')).toBe(false);
    expect(r1.objects.has('devsq:obs-1')).toBe(false);
    expect(r1.objects.size).toBe(r0.objects.size - 2);
    expect(obj(r1, 'con:identity').status).toBe('valid');
  });

  it('删除空组：该组全部派生对象被移除；对有观测的组无影响', () => {
    const s0 = benchmarkSource();
    s0.idCounter = 7;
    s0.dataset.groups.push({ id: 'grp-3', version: 1, name: 'C' });
    const r0 = rebuild(s0);
    expect(r0.objects.has('mean:grp-3')).toBe(true);
    const s1 = clone(s0);
    s1.dataset.groups = s1.dataset.groups.filter((g) => g.id !== 'grp-3');
    const r1 = rebuild(s1, r0.objects);
    expect(r1.objects.has('mean:grp-3')).toBe(false);
    expect(r1.objects.has('count:grp-3')).toBe(false);
    expect(value(r1, 'ssw')).toBe(value(r0, 'ssw'));
  });
});

describe('环检测与审计', () => {
  it('构造环 → KernelCycleError（内核缺陷，非用户输入错误）', () => {
    const nodes = new Map([
      ['a', { inputs: ['b'] }],
      ['b', { inputs: ['a'] }],
    ]);
    expect(() => topologicalOrder(nodes)).toThrow(KernelCycleError);
  });

  it('拓扑序：输入先于使用者（对基准图验证）', () => {
    const r = rebuild(benchmarkSource());
    const drafts = new Map<string, { inputs: string[] }>();
    for (const [id, o] of r.objects) drafts.set(id, { inputs: o.inputs });
    const order = topologicalOrder(drafts);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const [id, o] of r.objects) {
      for (const inp of o.inputs) {
        if (pos.has(inp)) {
          expect(pos.get(inp) as number, `${inp} 应先于 ${id}`).toBeLessThan(pos.get(id) as number);
        }
      }
    }
  });

  it('rebuild 后 audit 三项为空（全量与增量）', () => {
    const s0 = benchmarkSource();
    const r0 = rebuild(s0);
    const a0 = audit(r0.objects, r0.source);
    expect(a0.stale).toEqual([]);
    expect(a0.pending).toEqual([]);
    expect(a0.nonFinite).toEqual([]);
    const r1 = rebuild(commitValue(s0, 'obs-1', 9.5), r0.objects);
    const a1 = audit(r1.objects, r1.source);
    expect(a1).toEqual({ stale: [], pending: [], nonFinite: [] });
  });

  it('受影响集合（可达性）包含全部签名失配对象', () => {
    const s0 = benchmarkSource();
    const drafts = rebuild(s0).objects;
    const affected = affectedFrom(['obs-1'], new Map([...drafts].map(([id, o]) => [id, { inputs: o.inputs }])));
    const r1 = rebuild(commitValue(s0, 'obs-1', 9.5), drafts);
    for (const id of r1.changedObjectIds) {
      expect(affected.has(id), `${id} 应在可达集合内`).toBe(true);
    }
  });
});

/** 类型核对：DerivedObject 与 Result 的关键字段可被消费方直接读取 */
type _Check = [Result['source'], DerivedObject['inputsRevision']];
