// 事务测试：no-op、拒绝种类、拒绝零副作用、预览事务、版本一次递增、一命令一历史
import { describe, expect, it } from 'vitest';
import { benchmarkSource } from '../src/fixtures';
import { Store } from '../src/state/store';
import { value } from './helpers';

function freshStore(): Store {
  return new Store(benchmarkSource());
}

describe('no-op 与拒绝种类', () => {
  it('改成相同值：rejected(no-change)，版本、历史、通知指针均不变', () => {
    const store = freshStore();
    const before = store.getSnapshot();
    const res = store.dispatch({ type: 'setValue', obsId: 'obs-1', value: 4 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('no-change');
    const after = store.getSnapshot();
    expect(after.source).toBe(before.source);
    expect(after.canUndo).toBe(false);
    expect(after.source.dataset.observations[0]!.version).toBe(1);
  });

  it('未知目标 / 非法数值 / 组非空删除：各自的拒绝种类', () => {
    const store = freshStore();
    const r1 = store.dispatch({ type: 'setValue', obsId: 'obs-99', value: 1 });
    expect(!r1.ok && r1.kind).toBe('unknown-target');
    const r2 = store.dispatch({ type: 'setValue', obsId: 'obs-1', value: Number.NaN });
    expect(!r2.ok && r2.kind).toBe('invalid-input');
    const r3 = store.dispatch({ type: 'removeGroup', groupId: 'grp-1' });
    expect(!r3.ok && r3.kind).toBe('group-nonempty-delete');
    // 移走观测后可删除空组
    store.dispatch({ type: 'setGroup', obsId: 'obs-1', groupId: 'grp-2' });
    store.dispatch({ type: 'setGroup', obsId: 'obs-2', groupId: 'grp-2' });
    store.dispatch({ type: 'setGroup', obsId: 'obs-3', groupId: 'grp-2' });
    const r4 = store.dispatch({ type: 'removeGroup', groupId: 'grp-1' });
    expect(r4.ok).toBe(true);
    expect(store.getSnapshot().source.dataset.groups.length).toBe(1);
  });

  it('拒绝零副作用：可提交对象按引用完全不变', () => {
    const store = freshStore();
    const before = store.getSnapshot();
    store.dispatch({ type: 'setValue', obsId: 'obs-1', value: Number.POSITIVE_INFINITY });
    store.dispatch({ type: 'importCsv', text: 'group,value\nA,oops' });
    store.dispatch({ type: 'removeGroup', groupId: 'grp-1' });
    const after = store.getSnapshot();
    expect(after.source).toBe(before.source);
    expect(after.result).toBe(before.result);
    expect(after.canUndo).toBe(false);
    expect(after.canRedo).toBe(false);
  });
});

describe('版本与历史记录', () => {
  it('一条命令至多一次版本递增：setValueAndGroup 后撤销一次即整体还原', () => {
    const store = freshStore();
    const res = store.dispatch({ type: 'setValueAndGroup', obsId: 'obs-1', value: 9.5, groupId: 'grp-2' });
    expect(res.ok).toBe(true);
    const obs = store.getSnapshot().source.dataset.observations.find((o) => o.id === 'obs-1')!;
    expect(obs.version).toBe(2); // +1（值 + 组一起变，也只 +1）
    expect(obs.value).toBe(9.5);
    expect(obs.groupId).toBe('grp-2');
    // 一次撤销 → 值与组同时还原
    store.dispatch({ type: 'undo' });
    const back = store.getSnapshot().source.dataset.observations.find((o) => o.id === 'obs-1')!;
    expect(back.value).toBe(4);
    expect(back.groupId).toBe('grp-1');
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it('撤销/重做：数值往返一致', () => {
    const store = freshStore();
    store.dispatch({ type: 'setValue', obsId: 'obs-1', value: 9.5 });
    const v1 = value(store.getSnapshot().effective, 'sst');
    store.dispatch({ type: 'undo' });
    expect(value(store.getSnapshot().effective, 'sst')).toBeCloseTo(17.5, 9);
    store.dispatch({ type: 'redo' });
    expect(value(store.getSnapshot().effective, 'sst')).toBeCloseTo(v1, 9);
  });

  it('撤销后新提交：截断 redo 分支', () => {
    const store = freshStore();
    store.dispatch({ type: 'setValue', obsId: 'obs-1', value: 9.5 });
    store.dispatch({ type: 'undo' });
    expect(store.getSnapshot().canRedo).toBe(true);
    store.dispatch({ type: 'setValue', obsId: 'obs-2', value: 6 });
    expect(store.getSnapshot().canRedo).toBe(false);
  });
});

describe('预览事务（《状态与事务规范》§5.2）', () => {
  it('单一候选结果：effective 是预览结果，已提交结果不被触碰、不进历史', () => {
    const store = freshStore();
    const res = store.beginPreview({ type: 'setValue', obsId: 'obs-1', value: 9.5 });
    expect(res.ok).toBe(true);
    const snap = store.getSnapshot();
    expect(snap.ui.preview).not.toBeNull();
    expect(snap.effective).toBe(snap.ui.preview?.result); // 同一份结果对象
    expect(value(snap.result, 'sst')).toBeCloseTo(17.5, 9); // 已提交未变
    expect(value(snap.effective, 'sst')).not.toBeCloseTo(17.5, 9);
    expect(snap.canUndo).toBe(false);
  });

  it('更新预览：单一 PreviewResult 被整体替换，previewId 递增', () => {
    const store = freshStore();
    store.beginPreview({ type: 'setValue', obsId: 'obs-1', value: 9.5 });
    const id1 = store.getSnapshot().ui.preview!.previewId;
    store.updatePreview({ type: 'setValue', obsId: 'obs-1', value: 10 });
    const id2 = store.getSnapshot().ui.preview!.previewId;
    expect(id2).toBeGreaterThan(id1);
    expect(value(store.getSnapshot().effective, 'mean:grp-1')).toBeCloseTo((10 + 5 + 6) / 3, 9);
  });

  it('锁定范围：数学状态命令 rejected(preview-locked)；纯 UI 操作不受限', () => {
    const store = freshStore();
    store.beginPreview({ type: 'setValue', obsId: 'obs-1', value: 9.5 });
    const locked = store.dispatch({ type: 'setValue', obsId: 'obs-2', value: 1 });
    expect(!locked.ok && locked.kind).toBe('preview-locked');
    const lockedUndo = store.dispatch({ type: 'undo' });
    expect(!lockedUndo.ok && lockedUndo.kind).toBe('preview-locked');
    store.setUi({ selectedId: 'mean:grp-1' }); // 纯 UI 操作：允许
    expect(store.getSnapshot().ui.selectedId).toBe('mean:grp-1');
    expect(store.getSnapshot().ui.preview).not.toBeNull();
  });

  it('取消：零残留、不进历史、已提交状态不变', () => {
    const store = freshStore();
    const before = store.getSnapshot().result;
    store.beginPreview({ type: 'setValue', obsId: 'obs-1', value: 9.5 });
    store.cancelPreview();
    const snap = store.getSnapshot();
    expect(snap.ui.preview).toBeNull();
    expect(snap.result).toBe(before);
    expect(snap.canUndo).toBe(false);
    expect(value(snap.effective, 'sst')).toBeCloseTo(17.5, 9);
  });

  it('提交：一条命令一次提交一条历史（原子）', () => {
    const store = freshStore();
    store.beginPreview({ type: 'setValueAndGroup', obsId: 'obs-1', value: 9.5, groupId: 'grp-2' });
    const res = store.commitPreview();
    expect(res?.ok).toBe(true);
    const snap = store.getSnapshot();
    expect(snap.ui.preview).toBeNull();
    const obs = snap.source.dataset.observations.find((o) => o.id === 'obs-1')!;
    expect(obs.value).toBe(9.5);
    expect(obs.groupId).toBe('grp-2');
    expect(obs.version).toBe(2); // 一次递增
    store.dispatch({ type: 'undo' });
    const back = store.getSnapshot().source.dataset.observations.find((o) => o.id === 'obs-1')!;
    expect(back.value).toBe(4);
    expect(back.groupId).toBe('grp-1');
  });

  it('预览中的实例化差异实时反映（新增观测的预览不写入已提交图）', () => {
    const store = freshStore();
    store.beginPreview({ type: 'addObservation', groupId: 'grp-1', value: 10 });
    expect(store.getSnapshot().effective.objects.has('dev:obs-7')).toBe(true);
    expect(store.getSnapshot().result.objects.has('dev:obs-7')).toBe(false);
    store.cancelPreview();
    expect(store.getSnapshot().effective.objects.has('dev:obs-7')).toBe(false);
  });
});
