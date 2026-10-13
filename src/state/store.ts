// 事务层（《状态与事务规范》§4/§5）：
// 提交管线（校验 → 候选源 → rebuild → 原子换入 → 历史 → 单次通知）、
// 预览管线（单一候选结果、取消零残留、仅锁定数学状态命令）、撤销/重做。
// math 状态与 ui 状态分离；视图以 (effective, ui) 为唯一输入。

import type { Command, CommandKind, CommandResult, Result, SourceState, UiNotice, UiState } from '../kernel/types';
import { History } from '../kernel/history';
import { rebuild } from '../kernel/rebuild';
import { KernelError } from '../kernel/errors';
import { applyToSource, describeCommand } from './commands';

export interface StoreSnapshot {
  source: SourceState;
  /** 已提交结果 */
  result: Result;
  /** 视图唯一输入：预览中为预览结果，否则为已提交结果 */
  effective: Result;
  ui: UiState;
  canUndo: boolean;
  canRedo: boolean;
}

function rejected(cmd: Command, kind: CommandKind, reason: string, recovery?: string): CommandResult {
  return { ok: false, command: cmd, kind, reason, recovery };
}

export class Store {
  private source: SourceState;
  private result: Result;
  private history: History;
  private ui: UiState;
  private listeners = new Set<(s: StoreSnapshot) => void>();
  private previewCounter = 0;

  constructor(initial: SourceState) {
    this.source = structuredClone(initial);
    this.result = rebuild(this.source);
    this.history = new History(this.source);
    this.ui = {
      selectedId: null,
      focusId: null,
      preview: null,
      showSquares: false, // 默认关（设计文档 §10.3 的"默认开"按实际几何调整，映射规则不变）
      showVisualEdges: false,
      notice: null,
    };
  }

  getSnapshot(): StoreSnapshot {
    return {
      source: this.source,
      result: this.result,
      effective: this.ui.preview?.result ?? this.result,
      ui: this.ui,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
  }

  subscribe(fn: (s: StoreSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 纯 UI 操作：预览期间不受限（选中、聚焦、开关、视图切换） */
  setUi(patch: Partial<UiState>): void {
    this.ui = { ...this.ui, ...patch };
    this.notify();
  }

  // ---------- 提交管线 ----------

  dispatch(cmd: Command): CommandResult {
    if (this.ui.preview !== null) {
      this.setNotice('reject', '预览进行中：请先提交（Enter）或取消（Esc）');
      this.notify();
      return rejected(cmd, 'preview-locked', '预览进行中：请先提交或取消');
    }
    if (cmd.type === 'undo') return this.doUndo(cmd);
    if (cmd.type === 'redo') return this.doRedo(cmd);

    const applied = applyToSource(this.source, cmd);
    if (!applied.ok) {
      this.setNotice('reject', applied.reason);
      this.notify();
      return rejected(cmd, applied.kind, applied.reason, applied.recovery);
    }
    return this.commit(cmd, applied.next);
  }

  private commit(cmd: Command, next: SourceState): CommandResult {
    let result: Result;
    try {
      result = rebuild(next, this.result.objects);
    } catch (e) {
      const kind: CommandKind = cmd.type === 'importSnapshot' ? 'import-invalid' : 'internal-error';
      const reason = e instanceof KernelError ? e.message : String(e);
      this.setNotice('reject', reason);
      this.notify();
      return rejected(cmd, kind, reason);
    }
    this.source = next;
    this.result = result;
    this.history.push(next);
    this.fixSelection();
    this.setNotice('commit', `已提交：${describeCommand(cmd)}`);
    this.notify();
    return { ok: true, command: cmd, changedObjectIds: result.changedObjectIds };
  }

  private doUndo(cmd: Command): CommandResult {
    if (!this.history.canUndo) {
      this.setNotice('reject', '没有可撤销的操作');
      this.notify();
      return rejected(cmd, 'invalid-input', '没有可撤销的操作');
    }
    const prev = this.history.undo() as SourceState;
    this.source = prev;
    this.result = rebuild(prev, this.result.objects);
    this.fixSelection();
    this.setNotice('commit', '已撤销');
    this.notify();
    return { ok: true, command: cmd, changedObjectIds: this.result.changedObjectIds };
  }

  private doRedo(cmd: Command): CommandResult {
    if (!this.history.canRedo) {
      this.setNotice('reject', '没有可重做的操作');
      this.notify();
      return rejected(cmd, 'invalid-input', '没有可重做的操作');
    }
    const next = this.history.redo() as SourceState;
    this.source = next;
    this.result = rebuild(next, this.result.objects);
    this.fixSelection();
    this.setNotice('commit', '已重做');
    this.notify();
    return { ok: true, command: cmd, changedObjectIds: this.result.changedObjectIds };
  }

  // ---------- 预览管线 ----------

  beginPreview(cmd: Command): CommandResult {
    if (this.ui.preview !== null) return rejected(cmd, 'preview-locked', '已有进行中的预览');
    return this.computePreview(cmd);
  }

  updatePreview(cmd: Command): CommandResult {
    if (this.ui.preview === null) return rejected(cmd, 'invalid-input', '没有进行中的预览');
    return this.computePreview(cmd);
  }

  private computePreview(cmd: Command): CommandResult {
    const applied = applyToSource(this.source, cmd);
    if (!applied.ok) {
      this.setNotice('reject', applied.reason);
      this.notify();
      return rejected(cmd, applied.kind, applied.reason, applied.recovery);
    }
    let result: Result;
    try {
      result = rebuild(applied.next, this.result.objects);
    } catch (e) {
      // 预览失败：整份弃用，无部分更新（规范 §5.2）
      const reason = e instanceof KernelError ? e.message : String(e);
      this.ui = { ...this.ui, preview: null, notice: { kind: 'reject', text: `预览失败，已弃用：${reason}`, at: Date.now() } };
      this.notify();
      return rejected(cmd, 'internal-error', reason);
    }
    this.previewCounter += 1;
    this.ui = {
      ...this.ui,
      preview: { previewId: this.previewCounter, command: cmd, result },
      notice: { kind: 'preview', text: `预览：${describeCommand(cmd)}（未提交）`, at: Date.now() },
    };
    this.notify();
    return { ok: true, command: cmd, changedObjectIds: result.changedObjectIds };
  }

  /** 提交预览：一条命令、一次校验、一次提交、一条历史（原子） */
  commitPreview(): CommandResult | null {
    const p = this.ui.preview;
    if (p === null) return null;
    this.ui = { ...this.ui, preview: null };
    const applied = applyToSource(this.source, p.command);
    if (!applied.ok) {
      this.setNotice('reject', applied.reason);
      this.notify();
      return rejected(p.command, applied.kind, applied.reason, applied.recovery);
    }
    return this.commit(p.command, applied.next);
  }

  /** 取消预览：丢弃候选与其一切缓存，零残留 */
  cancelPreview(): void {
    if (this.ui.preview === null) return;
    this.ui = { ...this.ui, preview: null, notice: { kind: 'info', text: '已取消预览', at: Date.now() } };
    this.notify();
  }

  // ---------- 内部 ----------

  private setNotice(kind: UiNotice['kind'], text: string): void {
    this.ui = { ...this.ui, notice: { kind, text, at: Date.now() } };
  }

  private notify(): void {
    const s = this.getSnapshot();
    for (const fn of this.listeners) fn(s);
  }

  /** 撤销/删除后：选中对象仍存在则保留，否则清空 */
  private fixSelection(): void {
    const exists = (id: string | null): string | null => {
      if (id === null) return null;
      if (this.result.objects.has(id)) return id;
      const d = this.source.dataset;
      if (
        d.id === id ||
        d.observations.some((o) => o.id === id) ||
        d.groups.some((g) => g.id === id) ||
        d.variables.some((v) => v.id === id)
      ) {
        return id;
      }
      return null;
    };
    this.ui = { ...this.ui, selectedId: exists(this.ui.selectedId), focusId: exists(this.ui.focusId) };
  }
}
