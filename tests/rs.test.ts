import { describe, expect, it } from 'vitest';
import { gfPow, polyEval, polyMod } from '../src/lib/gf256';
import {
  CODE_BYTES,
  DATA_BYTES,
  GENERATOR,
  MAX_CORRECTABLE,
  PARITY_BYTES,
  decodeBounded,
  encodeSystematic,
  syndromes,
  wordToPoly,
} from '../src/lib/rs';
import { buildPayload } from '../src/lib/codec';

/** Deterministic PRNG (mulberry32) so the randomized sweeps are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomData(rand: () => number): number[] {
  return Array.from({ length: DATA_BYTES }, () => Math.floor(rand() * 256));
}

function hamming(a: readonly number[], b: readonly number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

describe('生成多项式 g(x) = ∏(x − 2^i), i = 0…7', () => {
  it('是 8 次首一多项式', () => {
    expect(GENERATOR.length).toBe(PARITY_BYTES + 1);
    expect(GENERATOR[PARITY_BYTES]).toBe(1);
  });

  it('以 2^0 … 2^7 为根', () => {
    for (let i = 0; i < PARITY_BYTES; i++) {
      expect(polyEval(GENERATOR, gfPow(2, i))).toBe(0);
    }
  });

  it('不以其它 2 的幂为根', () => {
    for (let i = PARITY_BYTES; i < 16; i++) {
      expect(polyEval(GENERATOR, gfPow(2, i))).not.toBe(0);
    }
  });
});

describe('系统式编码（前 22 字节数据 + 后 8 字节校验）', () => {
  it('码字长 30 字节，系统数据原样保留', () => {
    const data = buildPayload('STELE-7NORTH-GATE');
    const code = encodeSystematic(data);
    expect(code.length).toBe(CODE_BYTES);
    expect(code.slice(0, DATA_BYTES)).toEqual(data);
  });

  it('码字八个伴随式全为零，且能被生成多项式整除', () => {
    const rand = mulberry32(42);
    for (let t = 0; t < 50; t++) {
      const code = encodeSystematic(randomData(rand));
      expect(syndromes(code)).toEqual(new Array(PARITY_BYTES).fill(0));
      expect(polyMod(wordToPoly(code), GENERATOR)).toEqual(
        new Array(PARITY_BYTES).fill(0),
      );
    }
  });

  it('编码对数据长度严格校验', () => {
    expect(() => encodeSystematic([1, 2, 3])).toThrow();
  });
});

describe('有界距离解码', () => {
  const data = buildPayload('STELE-7NORTH-GATE');
  const code = encodeSystematic(data);

  it('无错误时原样通过', () => {
    const out = decodeBounded(code);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.corrected).toEqual(code);
      expect(out.errorPositions).toEqual([]);
    }
  });

  it('恰好 4 字节错误（纠错边界）可唯一恢复', () => {
    const cases: Array<[number[], number[]]> = [
      // [positions, error values]
      [[0, 1, 2, 3], [0x01, 0xff, 0x5a, 0xa5]],
      [[26, 27, 28, 29], [0x11, 0x22, 0x44, 0x88]], // 全在校验区
      [[0, 7, 15, 29], [0x01, 0x02, 0x04, 0x08]], // 首尾混合
      [[5, 6, 7, 8], [0xff, 0xff, 0xff, 0xff]],
    ];
    for (const [positions, values] of cases) {
      const received = code.slice();
      positions.forEach((p, i) => (received[p] ^= values[i]));
      const out = decodeBounded(received);
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.corrected).toEqual(code);
        expect(out.errorPositions).toEqual([...positions].sort((a, b) => a - b));
      }
    }
  });

  it('随机 1–4 字节错误全部唯一恢复（含边界 4）', () => {
    const rand = mulberry32(20260918);
    for (let t = 0; t < 400; t++) {
      const fresh = encodeSystematic(randomData(rand));
      const e = 1 + Math.floor(rand() * MAX_CORRECTABLE);
      const positions = new Set<number>();
      while (positions.size < e) positions.add(Math.floor(rand() * CODE_BYTES));
      const received = fresh.slice();
      for (const p of positions) {
        received[p] ^= 1 + Math.floor(rand() * 255);
      }
      const out = decodeBounded(received);
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.corrected).toEqual(fresh);
        expect(out.errorPositions.length).toBe(e);
      }
    }
  });

  it('5 字节错误超出半径，解码失败', () => {
    const received = code.slice();
    const positions = [0, 5, 11, 17, 23];
    const values = [0x01, 0x02, 0x04, 0x08, 0x10];
    positions.forEach((p, i) => (received[p] ^= values[i]));
    const out = decodeBounded(received);
    expect(out.ok).toBe(false);
  });

  it('6 字节错误同样失败', () => {
    const received = code.slice();
    const positions = [2, 9, 13, 20, 24, 28];
    const values = [0x03, 0x30, 0x55, 0xaa, 0x0f, 0xf0];
    positions.forEach((p, i) => (received[p] ^= values[i]));
    const out = decodeBounded(received);
    expect(out.ok).toBe(false);
  });

  it('不变量：解码一旦成功，结果必为距离 ≤4 的合法码字', () => {
    const rand = mulberry32(777);
    for (let t = 0; t < 600; t++) {
      const fresh = encodeSystematic(randomData(rand));
      const e = Math.floor(rand() * 8); // 0..7 个错误，超出半径的占多数
      const positions = new Set<number>();
      while (positions.size < e) positions.add(Math.floor(rand() * CODE_BYTES));
      const received = fresh.slice();
      for (const p of positions) received[p] ^= 1 + Math.floor(rand() * 255);
      const out = decodeBounded(received);
      if (out.ok) {
        expect(syndromes(out.corrected)).toEqual(new Array(PARITY_BYTES).fill(0));
        expect(hamming(received, out.corrected)).toBeLessThanOrEqual(MAX_CORRECTABLE);
        if (e <= MAX_CORRECTABLE) expect(out.corrected).toEqual(fresh);
      }
    }
  });

  it('对非 30 字节输入抛错', () => {
    expect(() => decodeBounded([1, 2, 3])).toThrow();
  });
});
