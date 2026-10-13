// 内核测试 Ⅲ：历史与快照（undo/redo 往返、序列化、导入管线拒绝、失败零副作用）
import { describe, expect, it } from 'vitest';
import { benchmarkSource, emptySource } from '../src/fixtures';
import { History } from '../src/kernel/history';
import { deepEqualSource, rebuild } from '../src/kernel/rebuild';
import { parseSource, serializeSource } from '../src/kernel/schema';
import { Store } from '../src/state/store';
import { obj, value } from './helpers';

describe('History：快照栈与指针', () => {
  it('push/undo/redo 往返；截断 redo 分支', () => {
    const s0 = benchmarkSource();
    const h = new History(s0);
    const s1 = structuredClone(s0);
    s1.dataset.revision += 1;
    const s2 = structuredClone(s0);
    s2.dataset.revision += 2;
    h.push(s1);
    h.push(s2);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    expect(deepEqualSource(h.undo() as never, s1)).toBe(true);
    expect(h.canRedo).toBe(true);
    expect(deepEqualSource(h.redo() as never, s2)).toBe(true);
    // 撤销后再提交 → 截断 redo
    h.undo();
    const s3 = structuredClone(s0);
    s3.dataset.revision += 3;
    h.push(s3);
    expect(h.canRedo).toBe(false);
    expect(deepEqualSource(h.undo() as never, s1)).toBe(true);
  });

  it('上限：超出丢弃最旧', () => {
    const h = new History(benchmarkSource(), 3);
    for (let i = 0; i < 5; i += 1) {
      const s = benchmarkSource();
      s.dataset.revision = 10 + i;
      h.push(s);
    }
    expect(h.size).toBe(3);
    expect(h.canUndo).toBe(true);
    // 只能回退 2 步（栈内共 3 个）
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
  });
});

describe('快照序列化（《状态与事务规范》§6）', () => {
  it('序列化 → 解析 → 重建 → 数值一致', () => {
    const s0 = benchmarkSource();
    const r0 = rebuild(s0);
    const parsed = parseSource(serializeSource(s0));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(deepEqualSource(parsed.state, s0)).toBe(true);
    const r1 = rebuild(parsed.state);
    for (const [id, o] of r0.objects) {
      const o2 = r1.objects.get(id);
      expect(o2, `对象 ${id}`).toBeDefined();
      expect(o2?.status).toBe(o.status);
      expect(o2?.value).toBe(o.value);
    }
  });

  it('未知 schemaVersion → 明确拒绝', () => {
    const bad = { ...benchmarkSource(), schemaVersion: 2 };
    const p = parseSource(JSON.stringify(bad));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join()).toContain('schemaVersion');
  });

  it('悬空引用 / 重复 id / idCounter 不足 / 非有限值 → 全部拒绝', () => {
    const base = benchmarkSource();

    const danglingGroup = structuredClone(base);
    danglingGroup.dataset.observations[0]!.groupId = 'grp-9';
    expect(parseSource(JSON.stringify(danglingGroup)).ok).toBe(false);

    const danglingBinding = structuredClone(base);
    danglingBinding.dataset.bindings.responseId = 'var-missing';
    expect(parseSource(JSON.stringify(danglingBinding)).ok).toBe(false);

    const dupId = structuredClone(base);
    dupId.dataset.observations[1]!.id = 'obs-1';
    expect(parseSource(JSON.stringify(dupId)).ok).toBe(false);

    const lowCounter = structuredClone(base);
    lowCounter.idCounter = 3;
    expect(parseSource(JSON.stringify(lowCounter)).ok).toBe(false);

    const nonFinite = structuredClone(base);
    nonFinite.dataset.observations[0]!.value = Number.POSITIVE_INFINITY;
    expect(parseSource(JSON.stringify(nonFinite)).ok).toBe(false);

    const notJson = parseSource('{oops');
    expect(notJson.ok).toBe(false);
  });

  it('解析成功 ≠ 导入成功：可解析但引用不存在的观测 id（等价形态：groupId）拒绝', () => {
    const broken = structuredClone(benchmarkSource());
    // 结构上可 JSON.parse，但引用了不存在的组
    broken.dataset.groups = broken.dataset.groups.filter((g) => g.id !== 'grp-1');
    const p = parseSource(JSON.stringify(broken));
    expect(p.ok).toBe(false);
  });
});

describe('导入的命令级行为：失败零副作用（不变量 B）', () => {
  it('损坏快照被拒绝：当前状态与历史指针完全不变', () => {
    const store = new Store(benchmarkSource());
    const before = store.getSnapshot();
    const res = store.dispatch({ type: 'importSnapshot', text: '{"schemaVersion":9}' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('import-invalid');
    const after = store.getSnapshot();
    expect(after.source).toBe(before.source); // 同一引用
    expect(after.result).toBe(before.result);
    expect(after.canUndo).toBe(before.canUndo);
    expect(after.canRedo).toBe(before.canRedo);
  });

  it('合法快照可导入、可撤销（导入进历史）', () => {
    const store = new Store(emptySource());
    const target = benchmarkSource();
    const res = store.dispatch({ type: 'importSnapshot', text: serializeSource(target) });
    expect(res.ok).toBe(true);
    expect(value(store.getSnapshot().effective, 'sst')).toBeCloseTo(17.5, 9);
    expect(store.getSnapshot().canUndo).toBe(true);
    store.dispatch({ type: 'undo' });
    expect(store.getSnapshot().source.dataset.observations.length).toBe(0);
  });
});

/** 引用核对：obj/value 辅助在撤销后的对象上同样工作 */
type _Check = [ReturnType<typeof obj>, ReturnType<typeof value>];
