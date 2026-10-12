// import.js — 数据导入解析（纯函数，无 DOM、无副作用）
// 约定：每行一条记录。「组别, 数值」两列也支持数值在前自动交换；
// 单列仅有数值时归入默认组；首行若两列都不是数值则按表头处理。
// 无效行不进入数据集，逐行报告行号与原因（在导入门中展示）。

export const DEFAULT_GROUP = '样本组';

export function parseRows(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const records = [];
  const invalid = [];
  let header = null;

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;

    let fields = line
      .split(/[,\t;]+/)
      .map((f) => f.trim())
      .filter((f) => f !== '');
    if (fields.length === 1) {
      fields = line.split(/\s+/).filter((f) => f !== '');
    }
    if (fields.length === 0) return;

    // 单列：只有数值可接受（首行非数值按表头）
    if (fields.length === 1) {
      const v = Number(fields[0]);
      if (Number.isFinite(v)) {
        records.push({ group: DEFAULT_GROUP, value: v });
      } else if (!header && records.length === 0) {
        header = { group: '分组', value: fields[0] };
      } else {
        invalid.push({ line: idx + 1, text: line, reason: '不是数值' });
      }
      return;
    }

    // 两列及以上：取前两列
    const a = Number(fields[0]);
    const b = Number(fields[1]);
    const aNum = Number.isFinite(a) && fields[0] !== '';
    const bNum = Number.isFinite(b) && fields[1] !== '';

    if (aNum && bNum) {
      // 两列都是数值：按「组别, 数值」列序处理（组名允许是数字，如教学班 1/2）
      records.push({ group: String(fields[0]), value: b });
      return;
    }
    if (bNum) {
      records.push({ group: String(fields[0]), value: b });
      return;
    }
    if (aNum) {
      records.push({ group: String(fields[1]), value: a });
      return;
    }
    // 两列都不是数值：首行按表头
    if (!header && records.length === 0) {
      header = { group: fields[0], value: fields[1] };
      return;
    }
    invalid.push({ line: idx + 1, text: line, reason: '找不到数值列' });
  });

  const groupNames = [...new Set(records.map((r) => r.group))];
  return {
    records,
    invalid,
    header,
    count: records.length,
    groupCount: groupNames.length,
    groupNames,
  };
}
