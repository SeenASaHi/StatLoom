// 命令 → 候选源状态（纯函数；不触碰历史/订阅/UI）。
// 校验规则：《状态与事务规范》§3（no-op、拒绝种类、一命令一次版本递增）。

import type { Command, CommandKind, Group, Observation, SourceState } from '../kernel/types';
import { MAX_GROUPS, MAX_OBSERVATIONS } from '../kernel/compute';
import { rebuild } from '../kernel/rebuild';
import { parseSource } from '../kernel/schema';
import { KernelError } from '../kernel/errors';
import { benchmarkSource, emptySource } from '../fixtures';
import { parseCsv } from '../csv';

export type ApplyOutcome =
  | { ok: true; next: SourceState }
  | { ok: false; kind: CommandKind; reason: string; recovery?: string };

const clone = (s: SourceState): SourceState => structuredClone(s);

const noChange = (reason = '未产生变化'): ApplyOutcome => ({ ok: false, kind: 'no-change', reason });
const invalid = (reason: string, recovery?: string): ApplyOutcome => ({ ok: false, kind: 'invalid-input', reason, recovery });
const missing = (what: string, id: string): ApplyOutcome => ({ ok: false, kind: 'unknown-target', reason: `${what} ${id} 不存在` });

function findObs(s: SourceState, id: string): Observation | undefined {
  return s.dataset.observations.find((o) => o.id === id);
}
function findGroup(s: SourceState, id: string): Group | undefined {
  return s.dataset.groups.find((g) => g.id === id);
}

export function applyToSource(source: SourceState, cmd: Command): ApplyOutcome {
  switch (cmd.type) {
    case 'setValue': {
      const o = findObs(source, cmd.obsId);
      if (o === undefined) return missing('观测', cmd.obsId);
      if (!Number.isFinite(cmd.value)) return invalid('数值必须是有限数值', '输入将被丢弃，保持原值');
      if (o.value === cmd.value) return noChange();
      const next = clone(source);
      const t = findObs(next, cmd.obsId) as Observation;
      t.value = cmd.value;
      t.version += 1;
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'setGroup': {
      const o = findObs(source, cmd.obsId);
      if (o === undefined) return missing('观测', cmd.obsId);
      if (findGroup(source, cmd.groupId) === undefined) return missing('组', cmd.groupId);
      if (o.groupId === cmd.groupId) return noChange();
      const next = clone(source);
      const t = findObs(next, cmd.obsId) as Observation;
      t.groupId = cmd.groupId;
      t.version += 1;
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'setValueAndGroup': {
      const o = findObs(source, cmd.obsId);
      if (o === undefined) return missing('观测', cmd.obsId);
      if (findGroup(source, cmd.groupId) === undefined) return missing('组', cmd.groupId);
      if (!Number.isFinite(cmd.value)) return invalid('数值必须是有限数值', '输入将被丢弃，保持原值');
      if (o.value === cmd.value && o.groupId === cmd.groupId) return noChange();
      const next = clone(source);
      const t = findObs(next, cmd.obsId) as Observation;
      t.value = cmd.value;
      t.groupId = cmd.groupId;
      t.version += 1; // 一条命令至多递增一次
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'addObservation': {
      if (findGroup(source, cmd.groupId) === undefined) return missing('组', cmd.groupId);
      if (!Number.isFinite(cmd.value)) return invalid('数值必须是有限数值');
      if (source.dataset.observations.length >= MAX_OBSERVATIONS) {
        return { ok: false, kind: 'capacity-exceeded', reason: `观测数已达上限 ${MAX_OBSERVATIONS}` };
      }
      const next = clone(source);
      next.dataset.observations.push({ id: `obs-${next.idCounter}`, version: 1, groupId: cmd.groupId, value: cmd.value });
      next.idCounter += 1; // 先分配后递增（idCounter = 下一个待分配号）
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'removeObservation': {
      if (findObs(source, cmd.obsId) === undefined) return missing('观测', cmd.obsId);
      const next = clone(source);
      next.dataset.observations = next.dataset.observations.filter((o) => o.id !== cmd.obsId);
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'addGroup': {
      const name = cmd.name.trim();
      if (name === '') return invalid('组名不能为空白');
      if (source.dataset.groups.length >= MAX_GROUPS) {
        return { ok: false, kind: 'capacity-exceeded', reason: `组数已达上限 ${MAX_GROUPS}` };
      }
      const next = clone(source);
      next.dataset.groups.push({ id: `grp-${next.idCounter}`, version: 1, name });
      next.idCounter += 1;
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'removeGroup': {
      const g = findGroup(source, cmd.groupId);
      if (g === undefined) return missing('组', cmd.groupId);
      const members = source.dataset.observations.filter((o) => o.groupId === cmd.groupId);
      if (members.length > 0) {
        return {
          ok: false,
          kind: 'group-nonempty-delete',
          reason: `组 ${g.name} 仍有 ${members.length} 个观测，不能删除`,
          recovery: '先移走或删除该组内的观测，再删除组',
        };
      }
      const next = clone(source);
      next.dataset.groups = next.dataset.groups.filter((x) => x.id !== cmd.groupId);
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'renameGroup': {
      const g = findGroup(source, cmd.groupId);
      if (g === undefined) return missing('组', cmd.groupId);
      const name = cmd.name.trim();
      if (name === '') return invalid('组名不能为空白');
      if (g.name === name) return noChange();
      const next = clone(source);
      const t = findGroup(next, cmd.groupId) as Group;
      t.name = name; // 改名不改变 groupId（身份稳定）
      t.version += 1;
      next.dataset.revision += 1;
      return { ok: true, next };
    }

    case 'loadBenchmark':
      return { ok: true, next: benchmarkSource() };

    case 'reset':
      return { ok: true, next: emptySource() };

    case 'importCsv': {
      const parsed = parseCsv(cmd.text);
      if (!parsed.ok) {
        return { ok: false, kind: 'import-invalid', reason: parsed.errors.join('；'), recovery: '修正后重新粘贴导入（不进行部分导入）' };
      }
      if (parsed.rows.length > MAX_OBSERVATIONS) {
        return { ok: false, kind: 'capacity-exceeded', reason: `数据行数 ${parsed.rows.length} 超过上限 ${MAX_OBSERVATIONS}` };
      }
      if (parsed.groups.length > MAX_GROUPS) {
        return { ok: false, kind: 'capacity-exceeded', reason: `组数 ${parsed.groups.length} 超过上限 ${MAX_GROUPS}` };
      }
      const next = emptySource();
      next.dataset.label = '导入数据';
      next.dataset.revision = 1;
      let counter = next.idCounter; // 1：下一个待分配号
      const groupIdOf = new Map<string, string>();
      for (const name of parsed.groups) {
        groupIdOf.set(name, `grp-${counter}`);
        next.dataset.groups.push({ id: `grp-${counter}`, version: 1, name });
        counter += 1;
      }
      for (const r of parsed.rows) {
        next.dataset.observations.push({ id: `obs-${counter}`, version: 1, groupId: groupIdOf.get(r.group) as string, value: r.value });
        counter += 1;
      }
      next.idCounter = counter;
      return { ok: true, next };
    }

    case 'importSnapshot': {
      const parsed = parseSource(cmd.text);
      if (!parsed.ok) {
        return { ok: false, kind: 'import-invalid', reason: parsed.errors.join('；'), recovery: '当前工作台保持不变' };
      }
      // 沙盒重建（含审计）：在全新图内验证后才允许换入
      try {
        rebuild(parsed.state);
      } catch (e) {
        const msg = e instanceof KernelError ? e.message : String(e);
        return { ok: false, kind: 'import-invalid', reason: `沙盒重建失败：${msg}`, recovery: '当前工作台保持不变' };
      }
      return { ok: true, next: parsed.state };
    }

    case 'undo':
    case 'redo':
      return { ok: false, kind: 'internal-error', reason: `命令 ${cmd.type} 应由事务层处理（不应到达 applyToSource）` };
  }
}

/** 命令的中文短描述（L3 标注与 aria-live 用） */
export function describeCommand(cmd: Command): string {
  switch (cmd.type) {
    case 'setValue': return `修改 ${cmd.obsId} = ${cmd.value}`;
    case 'setGroup': return `${cmd.obsId} → 组 ${cmd.groupId}`;
    case 'setValueAndGroup': return `${cmd.obsId} = ${cmd.value} → 组 ${cmd.groupId}`;
    case 'addObservation': return `新增观测到 ${cmd.groupId}`;
    case 'removeObservation': return `删除 ${cmd.obsId}`;
    case 'addGroup': return `新增组 ${cmd.name}`;
    case 'removeGroup': return `删除组 ${cmd.groupId}`;
    case 'renameGroup': return `重命名组 ${cmd.groupId} → ${cmd.name}`;
    case 'loadBenchmark': return '载入基准案例';
    case 'importCsv': return '导入 CSV';
    case 'importSnapshot': return '导入快照';
    case 'reset': return '清空工作台';
    case 'undo': return '撤销';
    case 'redo': return '重做';
  }
}
