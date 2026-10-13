// CSV 解析边界（《2026-10-13-原型设计.md》§9）：整批预检、坏行阻止导入
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv';

describe('parseCsv：合法输入', () => {
  it('基本两列 + 组顺序（首见序）', () => {
    const r = parseCsv('group,value\nA,1\nB,2\nA,3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { group: 'A', value: 1 },
      { group: 'B', value: 2 },
      { group: 'A', value: 3 },
    ]);
    expect(r.groups).toEqual(['A', 'B']);
  });

  it('引号包裹、字段内逗号与换行、转义引号', () => {
    const r = parseCsv('group,value\r\n"甲,组",1\r\n"乙\n组",2\r\n"A""1",3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]!.group).toBe('甲,组');
    expect(r.rows[1]!.group).toBe('乙\n组');
    expect(r.rows[2]!.group).toBe('A"1');
  });

  it('CRLF 与 BOM', () => {
    const r = parseCsv('﻿group,value\r\nA,1\r\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([{ group: 'A', value: 1 }]);
  });

  it('组名去首尾空白；组名允许空格与特殊字符', () => {
    const r = parseCsv('group,value\n" 甲 组 ",1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]!.group).toBe('甲 组');
  });
});

describe('parseCsv：错误整批阻止', () => {
  it('空的数值单元格不静默填补', () => {
    const r = parseCsv('group,value\nA,\nB,2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('数值为空');
  });

  it('非数值文本（含 Infinity 字面量）', () => {
    const r = parseCsv('group,value\nA,Infinity');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('数值非法');
  });

  it('空白组名', () => {
    const r = parseCsv('group,value\n   ,1');
    expect(r.ok).toBe(false);
  });

  it('多余列', () => {
    const r = parseCsv('group,value\nA,1,2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('两列');
  });

  it('未闭合引号', () => {
    const r = parseCsv('group,value\n"A,1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('未闭合');
  });

  it('表头列数错误', () => {
    const r = parseCsv('group,value,extra\nA,1,2');
    expect(r.ok).toBe(false);
  });

  it('只有表头', () => {
    const r = parseCsv('group,value');
    expect(r.ok).toBe(false);
  });

  it('一行坏 → 整批拒绝（报告行号）', () => {
    const r = parseCsv('group,value\nA,1\nB,oops\nC,3');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('第 3 行'))).toBe(true);
    }
  });
});
