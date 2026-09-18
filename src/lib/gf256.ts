/**
 * GF(256) 有限域运算，域模多项式 P(x) = x^8 + x^4 + x^3 + x^2 + 1 = 0x11d。
 * 生成元为 2（即本原多项式下的本原元）。
 *
 * 所有运算均对字节（0…255）闭合：加法即按位异或。
 */

const FIELD_POLY = 0x11d;

/** 指数表：expTable[i] = 2^i，i 为模 255 的对数值 */
const expTable = new Uint8Array(512);
/** 对数表：logTable[2^i] = i，0 无对数（此处占位为 0） */
const logTable = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    expTable[i] = x;
    logTable[x] = i;
    // x * 2：左移一位，溢出 x^8 则模除 P(x)
    x <<= 1;
    if (x & 0x100) x ^= FIELD_POLY;
  }
  // 复制一份免去取模运算
  for (let i = 255; i < 512; i++) expTable[i] = expTable[i - 255];
})();

/** 域加法（异或） */
export function add(a: number, b: number): number {
  return (a ^ b) & 0xff;
}

/** 域乘法 */
export function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return expTable[(logTable[a] + logTable[b]) % 255];
}

/** 域除法；除数为 0 时抛错 */
export function div(a: number, b: number): number {
  if (b === 0) throw new Error('GF(256) division by zero');
  if (a === 0) return 0;
  return expTable[(logTable[a] - logTable[b] + 255) % 255];
}

/** 求 a 的逆元；0 无逆元 */
export function inverse(a: number): number {
  if (a === 0) throw new Error('GF(256) zero has no inverse');
  return expTable[255 - logTable[a]];
}

/** 计算 a^n（n 为非负整数） */
export function pow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return expTable[(logTable[a] * n) % 255];
}

/** 对多项式 p（高次项在前）在点 x 处求值，Horner 法 */
export function polyEval(p: readonly number[], x: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) {
    y = mul(y, x) ^ p[i];
  }
  return y;
}

/**
 * 多项式乘法（高次项在前表示）。
 * 返回长度 a.length + b.length - 1 的系数数组。
 */
export function polyMul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] ^= mul(a[i], b[j]);
    }
  }
  return out;
}

/**
 * 多项式除法（高次项在前），返回 { quot, rem }，
 * rem.length === divisor.length - 1。
 */
export function polyDiv(
  dividend: readonly number[],
  divisor: readonly number[],
): { quot: number[]; rem: number[] } {
  if (divisor.some((c) => c !== 0) === false) throw new Error('division by zero polynomial');
  const out = dividend.slice();
  const lead = divisor[0];
  for (let i = 0; i <= dividend.length - divisor.length; i++) {
    const coef = out[i];
    if (coef === 0) continue;
    for (let j = 0; j < divisor.length; j++) {
      out[i + j] ^= mul(divisor[j], div(coef, lead));
    }
  }
  const cut = divisor.length - 1;
  return {
    quot: out.slice(0, out.length - cut),
    rem: out.slice(out.length - cut),
  };
}

/** 计算余项：dividend mod divisor（高次项在前），长度为 divisor.length - 1 */
export function polyMod(dividend: readonly number[], divisor: readonly number[]): number[] {
  return polyDiv(dividend, divisor).rem;
}

export const FIELD_MODULUS = FIELD_POLY;
