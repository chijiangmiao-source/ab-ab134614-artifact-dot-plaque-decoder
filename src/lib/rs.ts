/**
 * Reed–Solomon-style code over GF(256) (modulus 0x11d, primitive element 2).
 *
 * A codeword is 30 bytes. Read high-degree first, it forms a polynomial
 * c(x) = c0*x^29 + c1*x^28 + ... + c29 which must be divisible by the
 * generator polynomial g(x) = prod_{i=0..7} (x - 2^i).
 *
 * The first 22 bytes are systematic data, the last 8 are parity, so the
 * code has minimum distance 9 and corrects up to 4 byte errors.
 * Decoding is bounded-distance: Berlekamp–Massey + Chien search + Forney,
 * with a final syndrome re-check. Anything beyond distance 4 fails.
 */

import {
  gfDiv,
  gfInverse,
  gfMul,
  gfPow,
  polyDerivative,
  polyEval,
  polyMod,
  polyMul,
} from './gf256';

export const CODE_BYTES = 30;
export const DATA_BYTES = 22;
export const PARITY_BYTES = 8;
export const MAX_CORRECTABLE = PARITY_BYTES / 2; // 4

/** Generator polynomial g(x) = prod_{i=0}^{7} (x - 2^i), index = degree. */
export const GENERATOR: readonly number[] = (() => {
  let g: number[] = [1];
  for (let i = 0; i < PARITY_BYTES; i++) {
    g = polyMul(g, [gfPow(2, i), 1]); // (x - 2^i) == (x + 2^i) in char 2
  }
  return g;
})();

/** Word (byte 0 = highest-degree coefficient) -> polynomial (index = degree). */
export function wordToPoly(word: readonly number[]): number[] {
  const n = word.length;
  const p = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) p[n - 1 - j] = word[j];
  return p;
}

/** Polynomial (index = degree) -> word of n bytes, high-degree first. */
export function polyToWord(p: readonly number[], n: number = CODE_BYTES): number[] {
  const w = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) w[j] = p[n - 1 - j] ?? 0;
  return w;
}

/**
 * Systematic encoding: the 22 data bytes occupy the high-order positions
 * verbatim; the 8 parity bytes are the remainder of data*x^8 divided by g.
 */
export function encodeSystematic(data: readonly number[]): number[] {
  if (data.length !== DATA_BYTES) {
    throw new Error(`encodeSystematic: expected ${DATA_BYTES} data bytes, got ${data.length}`);
  }
  const msg = wordToPoly([...data, ...new Array<number>(PARITY_BYTES).fill(0)]);
  const remainder = polyMod(msg, GENERATOR);
  const codePoly = msg.slice();
  for (let i = 0; i < PARITY_BYTES; i++) {
    codePoly[i] = (codePoly[i] ?? 0) ^ (remainder[i] ?? 0);
  }
  return polyToWord(codePoly);
}

/** Syndromes S_i = c(2^i) for i = 0..7; all zero iff the word is a codeword. */
export function syndromes(word: readonly number[]): number[] {
  const p = wordToPoly(word);
  const s: number[] = [];
  for (let i = 0; i < PARITY_BYTES; i++) s.push(polyEval(p, gfPow(2, i)));
  return s;
}

/**
 * Berlekamp–Massey over the syndrome sequence S_0..S_7.
 * Returns the error-locator polynomial Lambda(x) = prod (1 - X_k x),
 * index = degree, with Lambda[0] = 1.
 */
function berlekampMassey(s: readonly number[]): number[] {
  let C: number[] = [1];
  let B: number[] = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let n = 0; n < s.length; n++) {
    let d = s[n];
    for (let i = 1; i <= L; i++) d ^= gfMul(C[i] ?? 0, s[n - i]);
    if (d === 0) {
      m++;
      continue;
    }
    const coef = gfDiv(d, b);
    const T = C;
    const next = new Array<number>(Math.max(C.length, B.length + m)).fill(0);
    for (let i = 0; i < C.length; i++) next[i] = C[i];
    for (let i = 0; i < B.length; i++) next[i + m] ^= gfMul(coef, B[i]);
    C = next;
    if (2 * L <= n) {
      L = n + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else {
      m++;
    }
  }
  return C.slice(0, L + 1);
}

export interface DecodeSuccess {
  ok: true;
  /** The recovered codeword (30 bytes). */
  corrected: number[];
  /** Byte positions (0..29) that were changed, ascending. */
  errorPositions: number[];
}

export interface DecodeFailure {
  ok: false;
}

export type DecodeOutcome = DecodeSuccess | DecodeFailure;

/**
 * Bounded-distance decoding: uniquely recovers the codeword when the
 * received word is within byte Hamming distance <= 4 of it; fails otherwise.
 */
export function decodeBounded(received: readonly number[]): DecodeOutcome {
  if (received.length !== CODE_BYTES) {
    throw new Error(`decodeBounded: expected ${CODE_BYTES} bytes, got ${received.length}`);
  }
  const s = syndromes(received);
  if (s.every((v) => v === 0)) {
    return { ok: true, corrected: received.slice(), errorPositions: [] };
  }

  const lambda = berlekampMassey(s);
  const numErrors = lambda.length - 1;
  if (numErrors < 1 || numErrors > MAX_CORRECTABLE) return { ok: false };

  // Chien search: byte position j (0 = first byte) has error locator
  // X = 2^(29-j); it is an error position iff Lambda(X^-1) = 0.
  const positions: number[] = [];
  for (let j = 0; j < CODE_BYTES; j++) {
    const xInv = gfPow(2, -(CODE_BYTES - 1 - j));
    if (polyEval(lambda, xInv) === 0) positions.push(j);
  }
  if (positions.length !== numErrors) return { ok: false };

  // Error evaluator Omega(x) = (S(x) * Lambda(x)) mod x^8.
  const omega = polyMul(s, lambda).slice(0, PARITY_BYTES);
  const lambdaPrime = polyDerivative(lambda);

  const corrected = received.slice();
  for (const j of positions) {
    const X = gfPow(2, CODE_BYTES - 1 - j);
    const xInv = gfInverse(X);
    const denominator = polyEval(lambdaPrime, xInv);
    if (denominator === 0) return { ok: false };
    // Forney: magnitude = X * Omega(X^-1) / Lambda'(X^-1).
    const magnitude = gfDiv(gfMul(X, polyEval(omega, xInv)), denominator);
    corrected[j] ^= magnitude;
  }

  // Bounded-distance guarantee: only accept if we truly landed on a codeword.
  if (!syndromes(corrected).every((v) => v === 0)) return { ok: false };
  if (positions.length > MAX_CORRECTABLE) return { ok: false };

  return { ok: true, corrected, errorPositions: positions };
}
