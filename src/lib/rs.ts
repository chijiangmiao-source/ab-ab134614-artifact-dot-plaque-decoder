/**
 * GF(256) 上的 Reed–Solomon 码（系统码视角）。
 *
 * 码字为 30 个字节，高次项在前形成多项式
 *   c(x) = c_0 x^29 + c_1 x^28 + … + c_29
 * 合法码字必须被生成多项式
 *   g(x) = ∏_{i=0}^{7} (x − 2^i)
 * 整除，故有 8 个校验字节，最小汉明距离 d = 9，最多纠正 t = 4 个字节错误。
 *
 * 校验子在连续 8 个点 2^0 … 2^7 上计算（窄义 BCH 视角），
 * 错误定位子与错误值子亦据此求解。
 */

import { add, div, inverse, mul, polyDiv, polyEval, polyMul, pow } from './gf256';

export const N = 30; // 码字字节数
export const NSYM = 8; // 校验字节数
export const T = 4; // 可纠正错误字节数上界
export const DATA_LEN = N - NSYM; // 22，系统数据字节数

/**
 * 生成多项式 g(x) = ∏_{i=0}^{7} (x − 2^i)，高次项在前，
 * 首项系数为 1，长度 9。
 */
export function generatorPolynomial(): number[] {
  let g = [1];
  for (let i = 0; i < NSYM; i++) {
    // x − 2^i；在 GF(256) 中减法即加法
    g = polyMul(g, [1, pow(2, i)]);
  }
  return g;
}

/**
 * 系统编码：输入 22 字节数据（高次项在前），返回完整 30 字节码字。
 * 余数取反在 GF(2) 上即余数本身（−r = r），直接追加。
 */
export function encode(data: readonly number[]): number[] {
  if (data.length !== DATA_LEN) {
    throw new Error(`systematic data must be ${DATA_LEN} bytes, got ${data.length}`);
  }
  const g = generatorPolynomial();
  const padded = data.concat(new Array<number>(NSYM).fill(0));
  const rem = polyDiv(padded, g).rem;
  return data.slice().concat(rem);
}

/** 校验子 S_j = c(2^j)，j = 0…7；全零当且仅当码字合法 */
export function syndromes(codeword: readonly number[]): number[] {
  const s: number[] = [];
  for (let j = 0; j < NSYM; j++) {
    s.push(polyEval(codeword, pow(2, j)));
  }
  return s;
}

/** 码字是否被 g(x) 整除（无错） */
export function isValidCodeword(codeword: readonly number[]): boolean {
  if (codeword.length !== N) return false;
  return syndromes(codeword).every((s) => s === 0);
}

/** Berlekamp–Massey 求错误定位子 Λ(x)（按次数从低到高返回系数） */
function berlekampMassey(s: readonly number[]): number[] {
  // C(x)、B(x)：按次数从低到高；C 即错误定位子
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let n = 0; n < s.length; n++) {
    // 差异 d = S_n + Σ_{i=1..L} C_i · S_{n-i}
    let d = s[n];
    for (let i = 1; i <= L; i++) {
      d ^= mul(C[i] ?? 0, s[n - i] ?? 0);
    }
    if (d === 0) {
      m++;
    } else {
      const T = C.slice();
      const coef = div(d, b);
      // C(x) ← C(x) − coef · x^m · B(x)
      for (let i = 0; i < B.length; i++) {
        const k = i + m;
        C[k] = add(C[k] ?? 0, mul(coef, B[i]));
      }
      if (2 * L <= n) {
        L = n + 1 - L;
        B = T;
        b = d;
        m = 1;
      } else {
        m++;
      }
    }
  }
  if (L > T) {
    throw new Error(`error count ${L} exceeds correction capacity ${T}`);
  }
  return C.slice(0, L + 1);
}

/** Chien 搜索：枚举 30 个码位，找出错误位置。返回位置下标（码字下标，0 起）。 */
function chienSearch(lambda: readonly number[]): number[] {
  const positions: number[] = [];
  for (let i = 0; i < N; i++) {
    // 码位 i（系数 c_i 对应 x^(N-1-i)）的定位元 X_i = 2^(N-1-i)
    const X = pow(2, N - 1 - i);
    // Λ(X^{-1}) = 0 表示该位置有错
    const Xi = inverse(X);
    let y = 0;
    let xPow = 1;
    for (let k = 0; k < lambda.length; k++) {
      y ^= mul(lambda[k] ?? 0, xPow);
      xPow = mul(xPow, Xi);
    }
    if (y === 0) positions.push(i);
  }
  return positions;
}

/**
 * Forney 算法求错误值。
 * 校验子生成元连续起点 b0 = 0（点 2^0 起）。
 */
function forneyErrorValues(
  positions: readonly number[],
  lambda: readonly number[],
  s: readonly number[],
): number[] {
  // 错误值子 Ω(x) = S(x)·Λ(x) mod x^8（校验子多项式按次数从低到高）
  const omega: number[] = new Array<number>(NSYM).fill(0);
  for (let i = 0; i < NSYM; i++) {
    let acc = 0;
    for (let j = 0; j <= i; j++) {
      acc ^= mul(s[j] ?? 0, lambda[i - j] ?? 0);
    }
    omega[i] = acc;
  }

  // Λ'(x)：形式导数，GF(2) 上奇次项保留
  const lambdaDeriv: number[] = [];
  for (let k = 1; k < lambda.length; k++) {
    lambdaDeriv[k - 1] = k % 2 === 1 ? lambda[k] : 0;
  }

  return positions.map((i) => {
    const X = pow(2, N - 1 - i);
    const Xi = inverse(X);
    // Ω(X^{-1})
    let omegaVal = 0;
    let xPow = 1;
    for (let k = 0; k < omega.length; k++) {
      omegaVal ^= mul(omega[k], xPow);
      xPow = mul(xPow, Xi);
    }
    // Λ'(X^{-1})
    let derivVal = 0;
    xPow = 1;
    for (let k = 0; k < lambdaDeriv.length; k++) {
      derivVal ^= mul(lambdaDeriv[k] ?? 0, xPow);
      xPow = mul(xPow, Xi);
    }
    if (derivVal === 0) throw new Error('Forney derivative is zero; uncorrectable');
    // e = X^(1 − b0) · Ω(X^{-1}) / Λ'(X^{-1})，b0 = 0
    let e = div(omegaVal, derivVal);
    e = mul(e, X);
    return e & 0xff;
  });
}

export interface Correction {
  /** 错误字节在码字中的下标（0 起，高次项在前） */
  position: number;
  /** 纠正前读到的字节 */
  before: number;
  /** 纠正后恢复的字节 */
  after: number;
}

export interface DecodeOk {
  ok: true;
  codeword: number[]; // 纠正后的完整合法码字
  corrections: Correction[];
}

export interface DecodeFail {
  ok: false;
  /** 机器可读的失败原因 */
  reason:
    | 'bad_length'
    | 'uncorrectable'
    | 'miscorrection_check_failed';
  /** 已检出但无法纠正的错误位置数（若可判定） */
  detectedErrors?: number;
}

/**
 * 有界距离解码：当且仅当存在与接收字节日汉明距离 ≤ 4 的唯一合法码字时恢复。
 *
 * 为保证“唯一恢复”，解码后重新计算校验子并复核距离，
 * 任何异常、定位数不符、距离超限或复核失败一律判为不可纠正，
 * 绝不返回猜测性的部分结果。
 */
export function decode(received: readonly number[]): DecodeOk | DecodeFail {
  if (received.length !== N) {
    return { ok: false, reason: 'bad_length' };
  }

  const s = syndromes(received);
  if (s.every((v) => v === 0)) {
    // 本身即为合法码字；零错误也是距离 0 的唯一情形
    return { ok: true, codeword: received.slice(), corrections: [] };
  }

  let lambda: number[];
  try {
    lambda = berlekampMassey(s);
  } catch {
    return { ok: false, reason: 'uncorrectable' };
  }

  let positions: number[];
  try {
    positions = chienSearch(lambda);
  } catch {
    return { ok: false, reason: 'uncorrectable' };
  }

  if (positions.length === 0 || positions.length > T) {
    return { ok: false, reason: 'uncorrectable', detectedErrors: positions.length };
  }
  // 定位子的全部根必须落在码位内，否则错误超出码长，不可纠正
  if (positions.length !== lambda.length - 1) {
    return { ok: false, reason: 'uncorrectable', detectedErrors: lambda.length - 1 };
  }

  let values: number[];
  try {
    values = forneyErrorValues(positions, lambda, s);
  } catch {
    return { ok: false, reason: 'uncorrectable' };
  }
  if (values.some((v) => v === 0)) {
    // 错误值为 0 说明定位与实际不符
    return { ok: false, reason: 'uncorrectable' };
  }

  const corrected = received.slice();
  const corrections: Correction[] = [];
  for (let k = 0; k < positions.length; k++) {
    const i = positions[k];
    const after = corrected[i] ^ values[k];
    corrections.push({ position: i, before: corrected[i], after });
    corrected[i] = after;
  }

  // 纠正后必须是合法码字
  if (!isValidCodeword(corrected)) {
    return { ok: false, reason: 'miscorrection_check_failed' };
  }

  // 有界距离：实际改动字节数即汉明距离，必须 ≤ t
  const dist = corrections.filter((c) => c.before !== c.after).length;
  if (dist > T) {
    return { ok: false, reason: 'uncorrectable', detectedErrors: dist };
  }

  corrections.sort((a, b) => a.position - b.position);
  return { ok: true, codeword: corrected, corrections };
}
