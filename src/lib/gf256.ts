/**
 * GF(2^8) arithmetic with field modulus x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
 * The primitive element is 2 (the polynomial x), so 2 generates the
 * multiplicative group of order 255.
 *
 * Polynomials over GF(256) are represented as number arrays where the
 * array index IS the degree: p[i] is the coefficient of x^i.
 */

export const FIELD_MODULUS = 0x11d;
export const FIELD_ORDER = 256;
export const FIELD_CHARACTERISTIC_ORDER = 255; // size of the multiplicative group

const EXP = new Uint8Array(512); // EXP[i] = 2^i, doubled so no mod is needed on lookup
const LOG = new Uint8Array(256); // LOG[a] = i such that 2^i = a (a != 0)

(function initTables(): void {
  let x = 1;
  for (let i = 0; i < FIELD_CHARACTERISTIC_ORDER; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & FIELD_ORDER) x ^= FIELD_MODULUS;
  }
  for (let i = FIELD_CHARACTERISTIC_ORDER; i < EXP.length; i++) {
    EXP[i] = EXP[i - FIELD_CHARACTERISTIC_ORDER];
  }
})();

export const gfExp: Uint8Array = EXP;
export const gfLog: Uint8Array = LOG;

/** Addition in GF(2^8) is bitwise XOR. */
export function gfAdd(a: number, b: number): number {
  return a ^ b;
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('GF(256): division by zero');
  if (a === 0) return 0;
  return EXP[LOG[a] + FIELD_CHARACTERISTIC_ORDER - LOG[b]];
}

export function gfInverse(a: number): number {
  if (a === 0) throw new Error('GF(256): inverse of zero');
  return EXP[FIELD_CHARACTERISTIC_ORDER - LOG[a]];
}

/** a^n in GF(2^8); n may be negative for nonzero a. */
export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  const e = ((LOG[a] * n) % FIELD_CHARACTERISTIC_ORDER) + FIELD_CHARACTERISTIC_ORDER;
  return EXP[e % FIELD_CHARACTERISTIC_ORDER];
}

/** Evaluate polynomial p (p[i] = coefficient of x^i) at point x via Horner. */
export function polyEval(p: readonly number[], x: number): number {
  let acc = 0;
  for (let i = p.length - 1; i >= 0; i--) {
    acc = gfMul(acc, x) ^ (p[i] ?? 0);
  }
  return acc;
}

/** Multiply two polynomials over GF(256). */
export function polyMul(a: readonly number[], b: readonly number[]): number[] {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === 0) continue;
      out[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return out;
}

/**
 * Remainder of polynomial `a` modulo the monic polynomial `mod`.
 * Returns a polynomial of degree < deg(mod).
 */
export function polyMod(a: readonly number[], mod: readonly number[]): number[] {
  const dm = mod.length - 1;
  if (dm < 0 || mod[dm] !== 1) throw new Error('polyMod: modulus must be monic');
  const r = a.slice();
  for (let d = r.length - 1; d >= dm; d--) {
    const c = r[d];
    if (c === 0) continue;
    for (let k = 0; k <= dm; k++) {
      r[d - dm + k] ^= gfMul(c, mod[k]);
    }
  }
  return r.slice(0, dm);
}

/** Formal derivative over characteristic 2: d/dx x^i = (i mod 2) * x^(i-1). */
export function polyDerivative(p: readonly number[]): number[] {
  const out = new Array<number>(Math.max(p.length - 1, 0)).fill(0);
  for (let i = 1; i < p.length; i++) {
    if (i % 2 === 1) out[i - 1] ^= p[i];
  }
  while (out.length > 0 && out[out.length - 1] === 0) out.pop();
  return out;
}
