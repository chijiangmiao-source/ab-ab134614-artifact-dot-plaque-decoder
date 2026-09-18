/**
 * 铭牌编码辅助：供文档示例、测试与验收夹具生成合法 16×16 位矩阵。
 * 生产 UI 不使用它（应用只做当前朝向的读入与纠错）。
 */

import { encode } from './rs';
import { BitGrid, DATA_BITS, emptyGrid, GRID, MARKER_ROW } from './plaque';

/** 由铭文内容构造 22 字节系统数据：长度 + 内容 + 0x00 填充 */
export function buildSystematicData(text: string): number[] {
  const bytes = Array.from(text).map((ch) => ch.charCodeAt(0));
  if (bytes.length < 1 || bytes.length > 20) {
    throw new Error('content length must be 1…20');
  }
  for (const b of bytes) {
    const ok =
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x30 && b <= 0x39) ||
      b === 0x2d;
    if (!ok) throw new Error('content must be ASCII uppercase letters, digits or hyphen');
  }
  const data = [bytes.length, ...bytes];
  while (data.length < 22) data.push(0x00);
  return data;
}

/** 编码内容为 30 字节合法码字 */
export function buildCodeword(text: string): number[] {
  return encode(buildSystematicData(text));
}

/** 把 30 字节码字连同顶行标记铺成 16×16 位矩阵（行优先、高位在前） */
export function codewordToGrid(codeword: readonly number[]): BitGrid {
  if (codeword.length !== 30) throw new Error('codeword must be 30 bytes');
  const grid = emptyGrid();
  grid[0] = MARKER_ROW.slice();

  const bits: number[] = [];
  for (const b of codeword) {
    for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  }
  if (bits.length !== DATA_BITS) throw new Error('expected 240 data bits');

  bits.forEach((bit, linear) => {
    const r = 1 + Math.floor(linear / GRID);
    const c = linear % GRID;
    grid[r][c] = bit;
  });
  return grid;
}

/** 便捷构造：铭文 → 合法位矩阵 */
export function buildPlaque(text: string): BitGrid {
  return codewordToGrid(buildCodeword(text));
}
