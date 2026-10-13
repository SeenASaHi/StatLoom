// 历史（《状态与事务规范》§5.3）：源状态快照栈 + 指针。
// 上限 200；失败与 no-op 均不改变指针；新提交截断 redo 分支。

import type { SourceState } from './types';
import { HISTORY_CAP } from './compute';

export class History {
  private snapshots: SourceState[] = [];
  private pointer = 0;

  constructor(initial: SourceState, private readonly cap: number = HISTORY_CAP) {
    this.snapshots.push(structuredClone(initial));
  }

  /** 已提交命令：截断 redo 分支后入栈；超限丢弃最旧 */
  push(next: SourceState): void {
    this.snapshots.length = this.pointer + 1;
    this.snapshots.push(structuredClone(next));
    if (this.snapshots.length > this.cap) {
      this.snapshots.splice(0, this.snapshots.length - this.cap);
    }
    this.pointer = this.snapshots.length - 1;
  }

  undo(): SourceState | null {
    if (this.pointer === 0) return null;
    this.pointer -= 1;
    return structuredClone(this.snapshots[this.pointer] as SourceState);
  }

  redo(): SourceState | null {
    if (this.pointer >= this.snapshots.length - 1) return null;
    this.pointer += 1;
    return structuredClone(this.snapshots[this.pointer] as SourceState);
  }

  get canUndo(): boolean {
    return this.pointer > 0;
  }

  get canRedo(): boolean {
    return this.pointer < this.snapshots.length - 1;
  }

  get size(): number {
    return this.snapshots.length;
  }
}
