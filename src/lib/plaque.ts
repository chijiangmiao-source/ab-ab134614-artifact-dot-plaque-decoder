/**
 * 16×16 点阵铭牌的当前朝向解析。
 *
 * 布局（仅以屏幕上当前朝向为准，应用不枚举任何其他旋向）：
 *   - 第 0 行为标记行：必须逐位等于 1011001011100001；
 *     标记行只用于确认朝向，不参与纠错编码，也不保存跨旋向坐标。
 *   - 其余 15 行共 240 位按行优先、每八位高位在前组成 30 个字节，
 *     字节按高次项在前形成码字多项式。
 */

export const GRID = 16;
export const MARKER_ROW = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1];
export const DATA_ROWS = 15;
export const DATA_BITS = DATA_ROWS * GRID; // 240
export const CODE_BYTES = 30;

/** 位矩阵：grid[r][c]，0 或 1，r/c 均为当前朝向屏幕坐标 */
export type BitGrid = number[][];

export function emptyGrid(): BitGrid {
  return Array.from({ length: GRID }, () => new Array<number>(GRID).fill(0));
}

/** 顺时针旋转 90°：new[r][c] = old[15-c][r]。返回新矩阵，不保留跨旋向坐标。 */
export function rotateClockwise(grid: BitGrid): BitGrid {
  const out = emptyGrid();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      out[r][c] = grid[GRID - 1 - c][r];
    }
  }
  return out;
}

/** 仅检查当前朝向：顶行是否等于标记位串 */
export function markerMatches(grid: BitGrid): boolean {
  for (let c = 0; c < GRID; c++) {
    if ((grid[0][c] & 1) !== MARKER_ROW[c]) return false;
  }
  return true;
}

/**
 * 将 240 个数据位按行优先、每八位高位在前打包为 30 字节。
 * 字节 i 取自当前朝向第 1 + floor(i/2) 行。
 */
export function packDataBits(grid: BitGrid): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < CODE_BYTES; i++) {
    let b = 0;
    for (let bit = 0; bit < 8; bit++) {
      const linear = i * 8 + bit;
      const r = 1 + Math.floor(linear / GRID);
      const c = linear % GRID;
      b = (b << 1) | (grid[r][c] & 1);
    }
    bytes.push(b & 0xff);
  }
  return bytes;
}

/**
 * 码字字节下标 → 该字节八个数据位在当前朝向中的行列格位。
 * 行号为屏幕行（1…15，标记行为 0），列号 0…15。
 * 每个格位按高位到低位排列。
 */
export function byteCellPositions(byteIndex: number): Array<{ r: number; c: number }> {
  const cells: Array<{ r: number; c: number }> = [];
  for (let bit = 0; bit < 8; bit++) {
    const linear = byteIndex * 8 + bit;
    cells.push({ r: 1 + Math.floor(linear / GRID), c: linear % GRID });
  }
  return cells;
}

/** 标记行中与规定位串不符的格位列号（当前朝向） */
export function markerErrorColumns(grid: BitGrid): number[] {
  const bad: number[] = [];
  for (let c = 0; c < GRID; c++) {
    if ((grid[0][c] & 1) !== MARKER_ROW[c]) bad.push(c);
  }
  return bad;
}

export interface ParsedPayload {
  /** 长度字节，须为 1…20 */
  length: number;
  /** 长度指定的内容字节 */
  contentBytes: number[];
  /** 内容文本（ASCII） */
  text: string;
}

export type PayloadError =
  | 'bad_length' // 长度字节不在 1…20
  | 'bad_charset' // 内容含非大写字母/数字/连字符
  | 'bad_padding'; // 长度之后未以 0x00 填满（含末尾固定 0x00）

/**
 * 校验并解析 22 字节系统数据：
 *   [0]    长度 L（1…20）
 *   [1..L] 内容，仅 ASCII 大写字母 A–Z、数字 0–9、连字符 '-'
 *   [L+1..21] 必须全部为 0x00（最后一字节即固定 0x00）
 */
export function parsePayload(data: readonly number[]): ParsedPayload | { error: PayloadError } {
  if (data.length !== 22) return { error: 'bad_length' };
  const length = data[0];
  if (length < 1 || length > 20) return { error: 'bad_length' };

  const contentBytes = data.slice(1, 1 + length);
  for (const b of contentBytes) {
    const ok =
      (b >= 0x41 && b <= 0x5a) || // A–Z
      (b >= 0x30 && b <= 0x39) || // 0–9
      b === 0x2d; // '-'
    if (!ok) return { error: 'bad_charset' };
  }

  for (let i = 1 + length; i < 22; i++) {
    if (data[i] !== 0x00) return { error: 'bad_padding' };
  }

  return {
    length,
    contentBytes,
    text: contentBytes.map((b) => String.fromCharCode(b)).join(''),
  };
}
