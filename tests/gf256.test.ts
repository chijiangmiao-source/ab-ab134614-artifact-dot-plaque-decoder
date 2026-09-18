import { describe, expect, it } from 'vitest';
import {
  FIELD_MODULUS,
  gfAdd,
  gfDiv,
  gfExp,
  gfInverse,
  gfLog,
  gfMul,
  gfPow,
  polyDerivative,
  polyEval,
  polyMod,
  polyMul,
} from '../src/lib/gf256';

describe('GF(256) 有限域（模 0x11d）', () => {
  it('模多项式为 x^8+x^4+x^3+x^2+1 (0x11d)', () => {
    expect(FIELD_MODULUS).toBe(0x11d);
    // x^8 约化为 x^4+x^3+x^2+1 = 0x1d
    expect(gfMul(0x80, 0x02)).toBe(0x1d);
    expect(gfPow(2, 8)).toBe(0b00011101);
  });

  it('2 是阶为 255 的本原元', () => {
    expect(gfPow(2, 255)).toBe(1);
    const seen = new Set<number>();
    for (let i = 0; i < 255; i++) {
      const v = gfPow(2, i);
      if (i > 0) expect(v).not.toBe(1);
      seen.add(v);
    }
    expect(seen.size).toBe(255); // 遍历全部非零元素
  });

  it('指数表与对数表互逆', () => {
    for (let i = 0; i < 255; i++) expect(gfLog[gfExp[i]]).toBe(i);
    for (let a = 1; a < 256; a++) expect(gfExp[gfLog[a]]).toBe(a);
  });

  it('每个非零元都有乘法逆元', () => {
    for (let a = 1; a < 256; a++) {
      expect(gfMul(a, gfInverse(a))).toBe(1);
    }
  });

  it('乘法交换律、结合律与对加法的分配律', () => {
    const samples = [0, 1, 2, 3, 0x1d, 0x53, 0x80, 0xff, 0xa5, 0x7e];
    for (const a of samples) {
      for (const b of samples) {
        expect(gfMul(a, b)).toBe(gfMul(b, a));
        expect(gfAdd(a, b)).toBe(a ^ b);
        for (const c of samples) {
          expect(gfMul(gfMul(a, b), c)).toBe(gfMul(a, gfMul(b, c)));
          expect(gfMul(a, gfAdd(b, c))).toBe(gfAdd(gfMul(a, b), gfMul(a, c)));
        }
      }
    }
  });

  it('除法是乘法的逆运算', () => {
    for (const a of [1, 2, 0x5a, 0xff, 0x01, 0xc3]) {
      for (const b of [1, 2, 3, 0x1d, 0xfe]) {
        expect(gfMul(gfDiv(a, b), b)).toBe(a);
      }
    }
    expect(() => gfDiv(1, 0)).toThrow();
    expect(() => gfInverse(0)).toThrow();
  });

  it('零元素性质', () => {
    expect(gfMul(0, 0x53)).toBe(0);
    expect(gfMul(0x53, 0)).toBe(0);
    expect(gfPow(0, 5)).toBe(0);
    expect(gfPow(0, 0)).toBe(1);
    expect(gfDiv(0, 7)).toBe(0);
  });
});

describe('GF(256) 多项式运算', () => {
  it('polyEval 按 Horner 法则求值', () => {
    // p(x) = x^2 + 2x + 3 -> [3, 2, 1]
    const p = [3, 2, 1];
    const x = 0x53;
    const expected = gfAdd(gfAdd(gfMul(x, x), gfMul(2, x)), 3);
    expect(polyEval(p, x)).toBe(expected);
    expect(polyEval([], x)).toBe(0);
    expect(polyEval([0, 0, 0], x)).toBe(0);
  });

  it('polyMul 与 polyMod 符合除法关系 a = q*m + r', () => {
    const m = [0x1d, 1]; // x + 0x1d
    const a = [1, 2, 3, 4, 5]; // 任意被除式
    const r = polyMod(a, m);
    expect(r.length).toBe(1);
    // a - r 应被 m 整除：在根处求值为零
    expect(polyEval(a, 0x1d)).toBe(r[0]);
    const product = polyMul([0x11, 0x22], [0x33, 0x44]);
    expect(polyMod(product, m).length).toBe(1);
  });

  it('特征 2 下的形式导数只保留奇次项', () => {
    // p(x) = x^4 + x^3 + x + 1 -> p'(x) = x^2 + 1
    expect(polyDerivative([1, 1, 0, 1, 1])).toEqual([1, 0, 1]);
    expect(polyDerivative([5])).toEqual([]);
  });
});
