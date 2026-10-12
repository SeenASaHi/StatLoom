// data.js — 数据集基座（无预设数据：原型以空数据集启动，数据完全来自导入）

export const DEFAULT_DATASET_NAME = '未命名数据集';
export const DEFAULT_GROUP = '样本组';

export function makeIdFactory(start = 1) {
  let seq = start;
  return () => 'r' + String(seq++).padStart(2, '0');
}

export function emptyDataset() {
  return { name: DEFAULT_DATASET_NAME, columns: { group: '分组', value: '数值' } };
}
