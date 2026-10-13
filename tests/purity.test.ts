// 层界护栏（启发式，声明其局限）：kernel/ 不得 import kernel 之外任何东西、
// 不得使用浏览器全局、不得依赖第三方包。扫描是防回归护栏，不是纯洁性证明。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const kernelDir = resolve(here, '../src/kernel');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FORBIDDEN_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'requestAnimationFrame', 'fetch'];

describe('kernel 层界', () => {
  const files = filesUnder(kernelDir);

  it('存在 kernel 源文件（扫描目标非空）', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it('不 import kernel 之外的任何模块（相对路径与别名一并解析；第三方包也在此列）', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1] as string;
        if (!spec.startsWith('.')) {
          throw new Error(`${file}：kernel 不得依赖第三方包或裸模块（${spec}）`);
        }
        const target = resolve(dirname(file), spec);
        if (!(target + sep).startsWith(kernelDir + sep) && target !== kernelDir) {
          throw new Error(`${file}：kernel 不得 import kernel 之外（${spec}）`);
        }
      }
    }
  });

  it('不使用浏览器全局（启发式词边界扫描）', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const g of FORBIDDEN_GLOBALS) {
        const re = new RegExp(`\\b${g}\\b`);
        if (re.test(src)) throw new Error(`${file}：kernel 使用了浏览器全局 ${g}`);
      }
    }
  });
});
