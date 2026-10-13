// 快照序列化与校验（《状态与事务规范》§6 的 ① 结构预检 + ② 引用完整性）。
// ③ 沙盒重建与 ④ 原子换入由调用方（state/commands + store）完成。

import type { SourceState } from './types';

export type ParseResult = { ok: true; state: SourceState } | { ok: false; errors: string[] };

export function serializeSource(state: SourceState): string {
  return JSON.stringify(state, null, 2);
}

export function parseSource(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${(e as Error).message}`] };
  }
  return validateSource(raw);
}

const ID_RE = /^(obs|grp)-(\d+)$/;

export function validateSource(raw: unknown): ParseResult {
  const errors: string[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const isStr = (x: unknown): x is string => typeof x === 'string';
  const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

  if (!isObj(raw)) return { ok: false, errors: ['快照根节点必须是对象'] };
  if (raw['schemaVersion'] !== 1) {
    return { ok: false, errors: [`未知的 schemaVersion：${String(raw['schemaVersion'])}（明确拒绝，不做静默迁移）`] };
  }
  if (!isInt(raw['idCounter']) || (raw['idCounter'] as number) < 0) errors.push('idCounter 必须是非负整数');

  const ds = raw['dataset'];
  if (!isObj(ds)) return { ok: false, errors: [...errors, 'dataset 缺失或非法'] };
  if (!isStr(ds['id']) || !isStr(ds['label'])) errors.push('dataset.id / label 必须为字符串');
  if (!isInt(ds['version']) || !isInt(ds['revision'])) errors.push('dataset.version / revision 必须为整数');

  const vars = ds['variables'];
  if (!Array.isArray(vars) || vars.length !== 2) {
    errors.push('variables 必须恰好是两个（一个数值响应变量 + 一个类别分组变量）');
  } else {
    const kinds = new Set<string>();
    const semantics = new Set<string>();
    for (const v of vars) {
      if (!isObj(v)) {
        errors.push('variable 条目必须是对象');
        continue;
      }
      if (!isStr(v['id']) || !isStr(v['name']) || !isInt(v['version'])) errors.push(`variable ${String(v['id'])} 字段非法`);
      kinds.add(String(v['kind']));
      semantics.add(String(v['semantic']));
    }
    if (!(kinds.has('numeric') && kinds.has('categorical'))) errors.push('variables 必须包含一个 numeric 与一个 categorical');
    if (!(semantics.has('response') && semantics.has('grouping'))) errors.push('variables 必须包含一个 response 与一个 grouping');
  }

  const bindings = ds['bindings'];
  if (!isObj(bindings)) {
    errors.push('bindings 缺失');
  } else if (Array.isArray(vars)) {
    const varIds = new Set(vars.filter(isObj).map((v) => String(v['id'])));
    if (!varIds.has(String(bindings['responseId']))) errors.push('bindings.responseId 指向不存在的变量');
    if (!varIds.has(String(bindings['groupingId']))) errors.push('bindings.groupingId 指向不存在的变量');
  }

  const groups = ds['groups'];
  const groupIds = new Set<string>();
  if (!Array.isArray(groups)) {
    errors.push('groups 必须是数组');
  } else {
    for (const g of groups) {
      if (!isObj(g) || !isStr(g['id']) || !isStr(g['name']) || !isInt(g['version'])) {
        errors.push('group 条目字段非法');
        continue;
      }
      if (!ID_RE.test(g['id'])) errors.push(`组 id 非法：${g['id']}`);
      if (g['name'].trim() === '') errors.push(`组名不能为空白：${g['id']}`);
      if (groupIds.has(g['id'])) errors.push(`组 id 重复：${g['id']}`);
      groupIds.add(g['id']);
    }
  }

  const obs = ds['observations'];
  const obsIds = new Set<string>();
  let maxSuffix = 0;
  if (!Array.isArray(obs)) {
    errors.push('observations 必须是数组');
  } else {
    for (const o of obs) {
      if (!isObj(o) || !isStr(o['id']) || !isStr(o['groupId']) || !isInt(o['version']) || typeof o['value'] !== 'number') {
        errors.push('observation 条目字段非法');
        continue;
      }
      const m = ID_RE.exec(o['id']);
      if (m === null) errors.push(`观测 id 非法：${o['id']}`);
      else maxSuffix = Math.max(maxSuffix, Number(m[2]));
      if (obsIds.has(o['id'])) errors.push(`观测 id 重复：${o['id']}`);
      obsIds.add(o['id']);
      if (!groupIds.has(o['groupId'])) errors.push(`观测 ${o['id']} 引用了不存在的组 ${o['groupId']}`);
      if (!Number.isFinite(o['value'])) errors.push(`观测 ${o['id']} 的值必须是有限数值`);
    }
  }
  for (const g of groupIds) {
    const m = ID_RE.exec(g);
    if (m !== null) maxSuffix = Math.max(maxSuffix, Number(m[2]));
  }
  if (isInt(raw['idCounter']) && (raw['idCounter'] as number) <= maxSuffix) {
    errors.push(`idCounter（${String(raw['idCounter'])}）必须大于已用最大编号（${maxSuffix}）`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, state: raw as unknown as SourceState };
}
