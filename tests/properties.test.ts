// 性质测试（fast-check）：平移/置换不变性、恒等式、依赖传播、增量 ≡ 全量
// 独立预期值来自 tests/helpers 的教科书公式实现（not 内核）。
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { benchmarkSource } from '../src/fixtures';
import { affectedFrom, audit } from '../src/kernel/graph';
import { identityThreshold } from '../src/kernel/compute';
import { rebuild } from '../src/kernel/rebuild';
import { applyToSource } from '../src/state/commands';
import type { Command, SourceState } from '../src/kernel/types';
import { expectNear, naiveStats, obj, toNaive, value } from './helpers';

const decimal = fc.integer({ min: -20000, max: 20000 }).map((i) => i / 100);

type RandomData = { groups: number[][] };

const randomData: fc.Arbitrary<RandomData> = fc
  .array(fc.array(decimal, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 4 })
  .map((groups) => ({ groups }));

function buildSource(data: RandomData): SourceState {
  const s = benchmarkSource();
  s.dataset.groups = [];
  s.dataset.observations = [];
  let counter = 1;
  data.groups.forEach((values, gi) => {
    const gid = `grp-${counter}`;
    s.dataset.groups.push({ id: gid, version: 1, name: `G${gi}` });
    counter += 1;
    for (const v of values) {
      s.dataset.observations.push({ id: `obs-${counter}`, version: 1, groupId: gid, value: v });
      counter += 1;
    }
  });
  s.idCounter = counter;
  return s;
}

describe('性质：参考一致（随机数据 vs 独立教科书实现）', () => {
  it('均值与三个平方和全部与独立实现一致', () => {
    fc.assert(
      fc.property(randomData, (data) => {
        const s = buildSource(data);
        const r = rebuild(s);
        const naive = naiveStats(toNaive(s));
        expectNear(value(r, 'mean:grand'), naive.grand);
        expectNear(value(r, 'ssw'), naive.ssw);
        expectNear(value(r, 'ssb'), naive.ssb);
        expectNear(value(r, 'sst'), naive.sst);
        expect(obj(r, 'con:identity').status).toBe('valid');
      }),
      { numRuns: 100 },
    );
  });
});

describe('性质：平移不变性', () => {
  it('整体平移 c：均值 +c，三个平方和不变', () => {
    fc.assert(
      fc.property(randomData, decimal, (data, c) => {
        const s0 = buildSource(data);
        const r0 = rebuild(s0);
        const s1 = buildSource(data);
        for (const o of s1.dataset.observations) {
          o.value += c;
          o.version += 1;
        }
        const r1 = rebuild(s1);
        expectNear(value(r1, 'mean:grand'), value(r0, 'mean:grand') + c);
        expectNear(value(r1, 'ssw'), value(r0, 'ssw'));
        expectNear(value(r1, 'ssb'), value(r0, 'ssb'));
        expectNear(value(r1, 'sst'), value(r0, 'sst'));
      }),
      { numRuns: 60 },
    );
  });

  it('组内平移 c：该组偏差与 SS_W 不变（总体均值与组间项按定义重算）', () => {
    fc.assert(
      fc.property(randomData, fc.nat(), decimal, (data, pick, c) => {
        const s0 = buildSource(data);
        const r0 = rebuild(s0);
        const target = s0.dataset.groups[pick % s0.dataset.groups.length]!;
        const s1 = structuredClone(s0);
        for (const o of s1.dataset.observations) {
          if (o.groupId === target.id) {
            o.value += c;
            o.version += 1;
          }
        }
        const r1 = rebuild(s1);
        // 该组内偏差不变
        for (const o of s1.dataset.observations) {
          if (o.groupId === target.id) {
            expectNear(value(r1, `dev:${o.id}`), value(r0, `dev:${o.id}`));
          }
        }
        expectNear(value(r1, 'ssw'), value(r0, 'ssw'));
        const naive = naiveStats(toNaive(s1));
        expectNear(value(r1, 'mean:grand'), naive.grand);
        expectNear(value(r1, 'ssb'), naive.ssb);
      }),
      { numRuns: 60 },
    );
  });
});

describe('性质：置换不变性', () => {
  it('打乱观测顺序：统计量不变（容差比较）', () => {
    fc.assert(
      fc.property(randomData, fc.nat(), (data, seed) => {
        const s0 = buildSource(data);
        const r0 = rebuild(s0);
        const s1 = structuredClone(s0);
        // 确定性洗牌（以 seed 驱动）
        const obs = s1.dataset.observations;
        let x = seed;
        for (let i = obs.length - 1; i > 0; i -= 1) {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          const j = x % (i + 1);
          const tmp = obs[i]!;
          obs[i] = obs[j]!;
          obs[j] = tmp;
        }
        const r1 = rebuild(s1);
        expectNear(value(r1, 'mean:grand'), value(r0, 'mean:grand'));
        expectNear(value(r1, 'ssw'), value(r0, 'ssw'));
        expectNear(value(r1, 'ssb'), value(r0, 'ssb'));
        expectNear(value(r1, 'sst'), value(r0, 'sst'));
      }),
      { numRuns: 60 },
    );
  });
});

describe('性质：恒等式', () => {
  it('随机合法数据：|SS_T − (SS_W + SS_B)| ≤ 容差公式', () => {
    fc.assert(
      fc.property(randomData, (data) => {
        const r = rebuild(buildSource(data));
        const ssw = value(r, 'ssw');
        const ssb = value(r, 'ssb');
        const sst = value(r, 'sst');
        expect(Math.abs(sst - (ssw + ssb))).toBeLessThanOrEqual(identityThreshold(ssw, ssb, sst));
        expect(obj(r, 'con:identity').status).toBe('valid');
      }),
      { numRuns: 100 },
    );
  });
});

describe('性质：依赖传播（受影响集合的双向精确性）', () => {
  it('重算集合在可达集合内；可达集合外对象引用完全不变', () => {
    const opArb = fc.oneof(
      fc.record({ kind: fc.constant('setValue' as const), i: fc.nat(), v: decimal }),
      fc.record({ kind: fc.constant('setGroup' as const), i: fc.nat(), gi: fc.nat() }),
      fc.record({ kind: fc.constant('addObservation' as const), gi: fc.nat(), v: decimal }),
      fc.record({ kind: fc.constant('removeObservation' as const), i: fc.nat() }),
    );
    fc.assert(
      fc.property(opArb, (op) => {
        const s0 = benchmarkSource();
        const r0 = rebuild(s0);
        const d = s0.dataset;
        let cmd: Command;
        switch (op.kind) {
          case 'setValue':
            cmd = { type: 'setValue', obsId: d.observations[op.i % d.observations.length]!.id, value: op.v };
            break;
          case 'setGroup':
            cmd = {
              type: 'setGroup',
              obsId: d.observations[op.i % d.observations.length]!.id,
              groupId: d.groups[op.gi % d.groups.length]!.id,
            };
            break;
          case 'addObservation':
            cmd = { type: 'addObservation', groupId: d.groups[op.gi % d.groups.length]!.id, value: op.v };
            break;
          case 'removeObservation':
            cmd = { type: 'removeObservation', obsId: d.observations[op.i % d.observations.length]!.id };
            break;
        }
        const applied = applyToSource(s0, cmd);
        if (!applied.ok) {
          expect(applied.kind).toBe('no-change'); // 拒绝仅允许 no-op（如 setGroup 选回本组）
          return;
        }
        const r1 = rebuild(applied.next, r0.objects);

        // 变更的源对象 id（version 与 s0 不一致的观测/组）
        const changedSourceIds = new Set<string>();
        for (const o of applied.next.dataset.observations) {
          const prev = s0.dataset.observations.find((p) => p.id === o.id);
          if (prev === undefined || prev.version !== o.version) changedSourceIds.add(o.id);
        }
        for (const o of s0.dataset.observations) {
          if (!applied.next.dataset.observations.some((x) => x.id === o.id)) changedSourceIds.add(o.id);
        }
        // 新旧图的并集（按边并，而非按节点覆盖）：删除观测时，被删对象在新图中已无消费者，
        // 但旧边（obs → 旧 dev → 旧 devsq → ssW）与"消失的输入"（count 的成员变化）都需保留，
        // 否则重算集合会漏出可达范围（《统一依赖图规范》§4）。
        const drafts = new Map<string, { inputs: string[] }>();
        const addInputs = (id: string, inputs: readonly string[]): void => {
          const cur = drafts.get(id);
          if (cur === undefined) {
            drafts.set(id, { inputs: [...inputs] });
            return;
          }
          for (const x of inputs) if (!cur.inputs.includes(x)) cur.inputs.push(x);
        };
        for (const [id, o] of r0.objects) addInputs(id, o.inputs);
        for (const [id, o] of r1.objects) addInputs(id, o.inputs);
        const affected = affectedFrom(changedSourceIds, drafts);

        // 方向一：重算集合 ⊆ 可达集合
        for (const id of r1.changedObjectIds) {
          expect(affected.has(id), `${id} 应在可达集合内`).toBe(true);
        }
        // 方向二：可达集合外的对象引用完全不变（五不变之身份）
        for (const [id] of r1.objects) {
          if (!affected.has(id)) {
            expect(r1.objects.get(id), `无关对象 ${id} 应复用同一实例`).toBe(r0.objects.get(id));
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('性质：不变量 A（增量 ≡ 全量）', () => {
  it('随机操作序列后：增量链结果与完整重建在值/状态/签名上等价，且 audit 为空', () => {
    const opArb = fc.oneof(
      fc.record({ kind: fc.constant('setValue' as const), i: fc.nat(), v: decimal }),
      fc.record({ kind: fc.constant('setGroup' as const), i: fc.nat(), gi: fc.nat() }),
      fc.record({ kind: fc.constant('addObservation' as const), gi: fc.nat(), v: decimal }),
      fc.record({ kind: fc.constant('removeObservation' as const), i: fc.nat() }),
      fc.record({ kind: fc.constant('addGroup' as const), n: fc.nat({ max: 99 }) }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        let source = benchmarkSource();
        let result = rebuild(source);
        for (const op of ops) {
          const d = source.dataset;
          let cmd: Command | null = null;
          switch (op.kind) {
            case 'setValue':
              if (d.observations.length > 0) cmd = { type: 'setValue', obsId: d.observations[op.i % d.observations.length]!.id, value: op.v };
              break;
            case 'setGroup':
              if (d.observations.length > 0) cmd = { type: 'setGroup', obsId: d.observations[op.i % d.observations.length]!.id, groupId: d.groups[op.gi % d.groups.length]!.id };
              break;
            case 'addObservation':
              if (d.groups.length > 0 && d.observations.length < 60) cmd = { type: 'addObservation', groupId: d.groups[op.gi % d.groups.length]!.id, value: op.v };
              break;
            case 'removeObservation':
              if (d.observations.length > 0) cmd = { type: 'removeObservation', obsId: d.observations[op.i % d.observations.length]!.id };
              break;
            case 'addGroup':
              if (d.groups.length < 8) cmd = { type: 'addGroup', name: `G${op.n}` };
              break;
          }
          if (cmd === null) continue;
          const applied = applyToSource(source, cmd);
          if (!applied.ok) continue; // 被拒绝的命令零副作用
          source = applied.next;
          result = rebuild(source, result.objects);
          const report = audit(result.objects, source);
          expect(report).toEqual({ stale: [], pending: [], nonFinite: [] });
        }
        // 与完整重建对比（版本不参与比较——身份与版本按各自规则验证）
        const full = rebuild(source);
        expect(full.objects.size).toBe(result.objects.size);
        for (const [id, a] of result.objects) {
          const b = full.objects.get(id);
          expect(b, `全量重建缺少 ${id}`).toBeDefined();
          if (b === undefined) continue;
          expect(a.value, `对象 ${id} 的值`).toBe(b.value);
          expect(a.status, `对象 ${id} 的状态`).toBe(b.status);
          expect(a.residual, `对象 ${id} 的残差`).toBe(b.residual);
          expect(a.inputs, `对象 ${id} 的输入`).toEqual(b.inputs);
          // 签名只比"输入集合"：inputsRevision 的版本值是路径相关的（派生 version 各自递增），
          // 规范等价范围即"依赖签名（集合＋ruleVersion）"，版本按各自规则验证。
          expect(Object.keys(a.inputsRevision).sort(), `对象 ${id} 的签名集合`).toEqual(
            Object.keys(b.inputsRevision).sort(),
          );
          expect(a.ruleVersion).toBe(b.ruleVersion);
        }
      }),
      { numRuns: 40 },
    );
  });
});
