// 内核错误：这些表示实现缺陷，不是用户输入错误（用户错误走 CommandResult.rejected）。

export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelError';
  }
}

export class KernelCycleError extends KernelError {
  constructor(public readonly cycle: string[]) {
    super(`计算依赖图成环（内核缺陷）：${cycle.join(' → ')}`);
    this.name = 'KernelCycleError';
  }
}
