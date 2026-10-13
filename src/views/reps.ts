// Representation 登记表（设计文档 §10.5）：只登记"数学对象 → 视觉元素"的映射，
// 不保存像素几何。检查器据此回答"哪些视觉对象使用了它"；折叠与过滤不影响本列表。

export interface RepEntry {
  viewId: string;
  kind: string;
  elementKey: string;
}

export class RepRegistry {
  private map = new Map<string, RepEntry[]>();

  clearView(viewId: string): void {
    for (const [target, list] of this.map) {
      const keep = list.filter((e) => e.viewId !== viewId);
      if (keep.length === 0) this.map.delete(target);
      else this.map.set(target, keep);
    }
  }

  register(targetId: string, entry: RepEntry): void {
    const list = this.map.get(targetId) ?? [];
    if (!list.some((e) => e.viewId === entry.viewId && e.kind === entry.kind && e.elementKey === entry.elementKey)) {
      list.push(entry);
      this.map.set(targetId, list);
    }
  }

  get(targetId: string): RepEntry[] {
    return this.map.get(targetId) ?? [];
  }
}
