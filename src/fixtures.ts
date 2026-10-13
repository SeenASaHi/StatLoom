// 示例数据（应用层；不属于 kernel）。基准案例：验收用例 A。
import type { SourceState } from './kernel/types';

export function emptySource(): SourceState {
  return {
    schemaVersion: 1,
    idCounter: 1, // 下一个待分配编号（规范：idCounter > 最大已用号；首号为 1）
    dataset: {
      id: 'ds-1',
      label: '未命名数据集',
      version: 1,
      revision: 0,
      variables: [
        { id: 'var-y', version: 1, name: 'y', kind: 'numeric', semantic: 'response' },
        { id: 'var-g', version: 1, name: '组别', kind: 'categorical', semantic: 'grouping' },
      ],
      bindings: { responseId: 'var-y', groupingId: 'var-g' },
      groups: [],
      observations: [],
    },
  };
}

/** 验收用例 A：A=[4,5,6]、B=[7,8,9] → 均值 6.5/5/8，SS_W=4，SS_B=13.5，SS_T=17.5 */
export function benchmarkSource(): SourceState {
  const s = emptySource();
  s.idCounter = 7; // 最大已用号 6 → 下一个待分配 7
  s.dataset.label = '基准案例 A';
  s.dataset.revision = 1;
  s.dataset.groups = [
    { id: 'grp-1', version: 1, name: 'A' },
    { id: 'grp-2', version: 1, name: 'B' },
  ];
  s.dataset.observations = [
    { id: 'obs-1', version: 1, groupId: 'grp-1', value: 4 },
    { id: 'obs-2', version: 1, groupId: 'grp-1', value: 5 },
    { id: 'obs-3', version: 1, groupId: 'grp-1', value: 6 },
    { id: 'obs-4', version: 1, groupId: 'grp-2', value: 7 },
    { id: 'obs-5', version: 1, groupId: 'grp-2', value: 8 },
    { id: 'obs-6', version: 1, groupId: 'grp-2', value: 9 },
  ];
  return s;
}
