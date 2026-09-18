/**
 * 铭牌修复总流程：只针对当前朝向执行一次，
 *   标记行检查 → 240 位打包 → RS 有界距离解码 → 系统载荷合法性校验。
 * 任何失败都只返回确定性的错误结论，绝不携带部分铭文。
 */

import { decode } from './rs';
import {
  BitGrid,
  byteCellPositions,
  markerErrorColumns,
  markerMatches,
  packDataBits,
  parsePayload,
  PayloadError,
} from './plaque';

export interface ResolvedCorrection {
  /** 码字字节下标（0 起，高次项在前） */
  byteIndex: number;
  /** 属于系统数据(0–21)还是校验(22–29) */
  zone: 'data' | 'check';
  before: number;
  after: number;
  /** 该字节 8 个位在当前解码朝向中的格位（高位在前） */
  cells: Array<{ r: number; c: number }>;
}

export type PlaqueResult =
  | { kind: 'marker_error'; badColumns: number[] }
  | { kind: 'uncorrectable' }
  | { kind: 'invalid_payload'; error: PayloadError }
  | {
      kind: 'ok';
      text: string;
      length: number;
      /** 纠正前的 30 字节（当前朝向读值） */
      received: number[];
      /** 纠正后的 30 字节合法码字 */
      codeword: number[];
      corrections: ResolvedCorrection[];
    };

export function decodePlaque(grid: BitGrid): PlaqueResult {
  // 1) 当前朝向标记行（顶行）必须精确匹配；标记行不参与纠错
  if (!markerMatches(grid)) {
    return { kind: 'marker_error', badColumns: markerErrorColumns(grid) };
  }

  // 2) 余下 240 位打包为 30 字节并做有界距离解码
  const received = packDataBits(grid);
  const result = decode(received);
  if (!result.ok) {
    return { kind: 'uncorrectable' };
  }

  // 3) 前 22 字节为系统数据，校验载荷格式
  const payload = parsePayload(result.codeword.slice(0, 22));
  if ('error' in payload) {
    return { kind: 'invalid_payload', error: payload.error };
  }

  const corrections: ResolvedCorrection[] = result.corrections.map((c) => ({
    byteIndex: c.position,
    zone: c.position < 22 ? 'data' : 'check',
    before: c.before,
    after: c.after,
    cells: byteCellPositions(c.position),
  }));

  return {
    kind: 'ok',
    text: payload.text,
    length: payload.length,
    received,
    codeword: result.codeword,
    corrections,
  };
}
