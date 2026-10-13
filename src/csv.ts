// 两列 CSV 解析（《2026-10-13-原型设计.md》§9）：RFC4180 引号/转义/字段内逗号与换行、
// CRLF、BOM；整批预检——任何错误行都阻止导入（不做静默跳行、不做部分导入）。
// 应用层模块（不属于 kernel），无第三方依赖。

export interface CsvRow {
  group: string;
  value: number;
}

export type CsvResult = { ok: true; rows: CsvRow[]; groups: string[] } | { ok: false; errors: string[] };

export function parseCsv(text: string): CsvResult {
  const errors: string[] = [];
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // BOM

  // ---- 分词：遵循引号规则的字段/行切分 ----
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let unterminated = false;
  while (i < src.length) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (field !== '') {
        errors.push(`第 ${rows.length + 1} 行：引号只能出现在字段起始处`);
      }
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (ch === '\r' && src[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) unterminated = true;
  row.push(field);
  rows.push(row);
  // 去掉末尾完全空行
  while (rows.length > 0 && (rows[rows.length - 1] as string[]).every((c) => c === '')) rows.pop();

  if (unterminated) errors.push('存在未闭合的引号（字段内的引号必须成对或转义为 ""）');
  if (rows.length === 0) return { ok: false, errors: [...errors, '没有任何内容'] };

  // ---- 表头 ----
  const header = rows[0] as string[];
  if (header.length !== 2) {
    return { ok: false, errors: [...errors, `表头必须是两列（group,value），当前为 ${header.length} 列`] };
  }
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) errors.push('只有表头，没有数据行');

  // ---- 数据行 ----
  const parsed: CsvRow[] = [];
  const groups: string[] = [];
  for (let r = 0; r < dataRows.length; r += 1) {
    const cells = dataRows[r] as string[];
    const lineNo = r + 2; // 含表头的行号
    if (cells.length !== 2) {
      errors.push(`第 ${lineNo} 行：需要恰好两列，当前 ${cells.length} 列`);
      continue;
    }
    const group = (cells[0] as string).trim();
    const valueText = (cells[1] as string).trim();
    if (group === '') {
      errors.push(`第 ${lineNo} 行：组名为空`);
      continue;
    }
    if (valueText === '') {
      errors.push(`第 ${lineNo} 行：数值为空（不静默填补缺失值）`);
      continue;
    }
    const value = Number(valueText);
    if (!Number.isFinite(value)) {
      errors.push(`第 ${lineNo} 行：数值非法（"${valueText}" 不是有限数值）`);
      continue;
    }
    parsed.push({ group, value });
    if (!groups.includes(group)) groups.push(group);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows: parsed, groups };
}
