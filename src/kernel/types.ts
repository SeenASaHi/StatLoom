// StatLoom 内核契约类型（冻结）。
// 规范来源：test3/docs/{2026-10-13-原型设计.md, AST操作集规范.md, 统一依赖图规范.md, 状态与事务规范.md}
// 约束：本文件及 kernel/ 全部模块不 import 任何 kernel 之外的东西（purity.test.ts 强制）。

// ---------- 状态与理由（《状态与事务规范》§1/§2） ----------

export type Status = 'pending' | 'valid' | 'undefined' | 'invalid' | 'error';

export type ObjectReasonCode =
  | 'empty-scope'        // 空作用域的 sum/mean
  | 'empty-dataset'      // 空数据集上的统计量
  | 'input-not-valid'    // 输入非 valid 的传播
  | 'non-finite-result'  // 求值结果非有限（含溢出）
  | 'tolerance-exceeded'; // 恒等式残差超容差

export interface ObjectReason {
  code: ObjectReasonCode;
  message: string;
  /** 传播来源：非 valid 的输入对象 id（code = input-not-valid 时） */
  inputs?: string[];
}

export interface EvalOutcome {
  status: Status;
  value?: number;
  reason?: ObjectReason;
}

// ---------- 源对象（《统一依赖图规范》/设计文档 §4.1，唯一事实来源） ----------

export interface VariableMeta {
  id: string;
  version: number;
  name: string;
  kind: 'numeric' | 'categorical';
  semantic: 'response' | 'grouping';
}

export interface Group {
  id: string;
  version: number;
  name: string;
}

export interface Observation {
  id: string;
  version: number;
  groupId: string;
  value: number;
}

export interface Dataset {
  id: string;
  label: string;
  version: number;
  /** 数据集内容整体变化的粗粒度版本；每条已提交命令 +1 */
  revision: number;
  /** 本原型明确限制：恰好 1 个响应变量 + 1 个分组变量 */
  variables: VariableMeta[];
  bindings: { responseId: string; groupingId: string };
  groups: Group[];
  /** 观测的唯一存放位置（权威来源）；反向索引一律派生 */
  observations: Observation[];
}

export interface SourceState {
  schemaVersion: 1;
  dataset: Dataset;
  /** obs-<n> / grp-<n> 的单调分配器；一经分配不复用（快照恢复同一身份除外） */
  idCounter: number;
}

// ---------- 表达式 AST（《AST操作集规范》§2/§3；11 节点 + 3 作用域形态） ----------

export type LoopVar = 'o' | 'g';

export type Scope =
  | { kind: 'all' }
  | { kind: 'groupOf'; of: Expr }
  | { kind: 'groupsWithObservations' };

export type RoleName =
  | 'groupCount'
  | 'groupMean'
  | 'grandMean'
  | 'deviation'
  | 'squaredDeviation'
  | 'groupMeanDeviation'
  | 'squaredGroupMeanDeviation'
  | 'ssWithin'
  | 'ssBetween'
  | 'ssTotal';

export type RefTarget =
  | { kind: 'role'; role: RoleName; of?: Expr }
  | { kind: 'id'; id: string };

export type Expr =
  | { op: 'const'; value: number }
  | { op: 'var'; name: LoopVar }
  | { op: 'valueOf'; of: Expr }
  | { op: 'ref'; target: RefTarget }
  | { op: 'sum'; scope: Scope; term: Expr }
  | { op: 'mean'; scope: Scope; term: Expr }
  | { op: 'count'; scope: Scope }
  | { op: 'add'; args: [Expr, Expr] }
  | { op: 'sub'; args: [Expr, Expr] }
  | { op: 'mul'; args: [Expr, Expr] }
  | { op: 'pow2'; arg: Expr };

export type StatisticKind =
  | 'count'
  | 'mean'
  | 'deviation'
  | 'squaredDeviation'
  | 'groupMeanDeviation'
  | 'squaredGroupMeanDeviation'
  | 'ssWithin'
  | 'ssBetween'
  | 'ssTotal';

export interface ExprDefinition {
  defId: string;
  class: 'statistic' | 'constraint';
  statisticKind?: StatisticKind;
  ruleVersion: number;
  freeVars: LoopVar[];
  template: Expr;
}

// ---------- 派生对象（Statistic / Constraint / ExpressionInstance 的统一表示） ----------

/** 实例化产物：求值前；inputs 由模板引用遍历推导（《统一依赖图规范》§2） */
export interface Draft {
  id: string;
  defId: string;
  class: 'statistic' | 'constraint';
  bindings: Partial<Record<LoopVar, string>>;
  /** 角色解析结果：角色名 → 对象 id（实例层不再含角色） */
  refs: Record<string, string>;
  /** 排序去重后的输入 id 集 = refs 的并集 ∪ 作用域成员 */
  inputs: string[];
}

export interface DerivedObject {
  id: string;
  defId: string;
  class: 'statistic' | 'constraint';
  bindings: Partial<Record<LoopVar, string>>;
  refs: Record<string, string>;
  inputs: string[];
  /** 派生对象版本：value/status/reason 变化时递增（《统一依赖图规范》§3） */
  version: number;
  status: Status;
  reason?: ObjectReason;
  value?: number;
  /** 仅 constraint：恒等式残差（未格式化原始值；格式化永不回写） */
  residual?: number;
  /** 输入 id → 读取时的输入对象 version */
  inputsRevision: Record<string, number>;
  ruleVersion: number;
}

export interface AuditReport {
  stale: string[];
  pending: string[];
  nonFinite: string[];
}

// ---------- 结果与命令（《状态与事务规范》§3/§4/§5） ----------

export interface Result {
  source: SourceState;
  objects: ReadonlyMap<string, DerivedObject>;
  /** 本次重建中未复用（新求值或新创建）的派生对象 id */
  changedObjectIds: string[];
}

export type Command =
  | { type: 'setValue'; obsId: string; value: number }
  | { type: 'setGroup'; obsId: string; groupId: string }
  | { type: 'setValueAndGroup'; obsId: string; value: number; groupId: string }
  | { type: 'addObservation'; groupId: string; value: number }
  | { type: 'removeObservation'; obsId: string }
  | { type: 'addGroup'; name: string }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'loadBenchmark' }
  | { type: 'importCsv'; text: string }
  | { type: 'importSnapshot'; text: string }
  | { type: 'reset' }
  | { type: 'undo' }
  | { type: 'redo' };

export type CommandKind =
  | 'invalid-input'
  | 'no-change'
  | 'group-nonempty-delete'
  | 'unknown-target'
  | 'preview-locked'
  | 'import-invalid'
  | 'capacity-exceeded'
  | 'internal-error';

export type CommandResult =
  | { ok: true; command: Command; changedObjectIds: string[] }
  | { ok: false; command: Command; kind: CommandKind; reason: string; recovery?: string };

// ---------- 预览与 UI 状态 ----------

export interface PreviewState {
  previewId: number;
  command: Command;
  /** 单一候选结果：全部视图只读这一份（《状态与事务规范》§5.2） */
  result: Result;
}

export interface UiNotice {
  kind: 'preview' | 'commit' | 'reject' | 'info';
  text: string;
  at: number;
}

export interface UiState {
  selectedId: string | null;
  focusId: string | null;
  preview: PreviewState | null;
  /** 画布窗内开关：平方偏差面积块（默认关：基准尺度下几乎必然裁切，见 findings 记录） */
  showSquares: boolean;
  /** 关系图边过滤：视觉映射边（默认隐藏） */
  showVisualEdges: boolean;
  notice: UiNotice | null;
}
