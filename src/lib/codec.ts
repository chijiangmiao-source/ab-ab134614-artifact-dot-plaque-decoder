/**
 * Mapping between the 16x16 dot-matrix grid and the 30-byte codeword,
 * plus payload (inscription) validation.
 *
 * Grid layout (row 0 is the TOP row as currently displayed):
 *   - row 0:        16 marker bits, must equal MARKER ("1011001011100001").
 *                   The marker row only fixes orientation; it is NOT part
 *                   of the error-corrected data.
 *   - rows 1..15:   240 data bits, read row-major, 8 bits per byte with the
 *                   most significant bit first, yielding 30 bytes.
 *
 * Only the current orientation is ever inspected. Rotation rewrites the
 * grid itself, so every reported row/column refers to the orientation in
 * which decoding happened; no cross-rotation coordinates are kept.
 */

import { CODE_BYTES, DATA_BYTES, decodeBounded } from './rs';

export const GRID_SIZE = 16;
export const MARKER = '1011001011100001';
export const MAX_INSCRIPTION_LENGTH = 20;

/** grid[row][col]; true = filled (black) cell = bit 1. */
export type Grid = boolean[][];

export function emptyGrid(): Grid {
  return Array.from({ length: GRID_SIZE }, () => new Array<boolean>(GRID_SIZE).fill(false));
}

/** Rotate the grid 90 degrees clockwise: cell (r, c) moves to (c, N-1-r). */
export function rotateCW(g: Grid): Grid {
  const out = emptyGrid();
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      out[c][GRID_SIZE - 1 - r] = g[r][c];
    }
  }
  return out;
}

/** The 16 bits of the top row, '1' for a filled cell. */
export function markerBits(g: Grid): string {
  return g[0].map((filled) => (filled ? '1' : '0')).join('');
}

/** Grid position (0-based) of byte k: two bytes per row starting at row 1. */
export function byteCell(k: number): { row: number; col: number } {
  return { row: 1 + (k >> 1), col: (k & 1) === 0 ? 0 : 8 };
}

/** Extract the 30 codeword bytes from rows 1..15 (marker row excluded). */
export function gridToBytes(g: Grid): number[] {
  const bytes: number[] = [];
  for (let k = 0; k < CODE_BYTES; k++) {
    const { row, col } = byteCell(k);
    let v = 0;
    for (let b = 0; b < 8; b++) {
      v = (v << 1) | (g[row][col + b] ? 1 : 0);
    }
    bytes.push(v);
  }
  return bytes;
}

/** Build a grid from 30 codeword bytes, stamping the marker row on top. */
export function bytesToGrid(bytes: readonly number[]): Grid {
  if (bytes.length !== CODE_BYTES) {
    throw new Error(`bytesToGrid: expected ${CODE_BYTES} bytes, got ${bytes.length}`);
  }
  const g = emptyGrid();
  for (let c = 0; c < GRID_SIZE; c++) g[0][c] = MARKER[c] === '1';
  for (let k = 0; k < CODE_BYTES; k++) {
    const { row, col } = byteCell(k);
    for (let b = 0; b < 8; b++) {
      g[row][col + b] = ((bytes[k] >> (7 - b)) & 1) === 1;
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Payload: 22 systematic bytes = length (1..20) + 20 content bytes + 0x00.
// Content bytes beyond the declared length must be 0x00.
// ---------------------------------------------------------------------------

export type PayloadError = 'length' | 'character' | 'padding' | 'terminator';

export type PayloadResult =
  | { ok: true; inscription: string }
  | { ok: false; error: PayloadError };

function isContentByte(v: number): boolean {
  return (
    (v >= 0x41 && v <= 0x5a) || // A-Z
    (v >= 0x30 && v <= 0x39) || // 0-9
    v === 0x2d // '-'
  );
}

export function parsePayload(data: readonly number[]): PayloadResult {
  if (data.length !== DATA_BYTES) {
    throw new Error(`parsePayload: expected ${DATA_BYTES} bytes, got ${data.length}`);
  }
  const len = data[0];
  if (len < 1 || len > MAX_INSCRIPTION_LENGTH) return { ok: false, error: 'length' };
  for (let i = 0; i < len; i++) {
    if (!isContentByte(data[1 + i])) return { ok: false, error: 'character' };
  }
  for (let i = 1 + len; i < DATA_BYTES - 1; i++) {
    if (data[i] !== 0x00) return { ok: false, error: 'padding' };
  }
  if (data[DATA_BYTES - 1] !== 0x00) return { ok: false, error: 'terminator' };
  let inscription = '';
  for (let i = 0; i < len; i++) inscription += String.fromCharCode(data[1 + i]);
  return { ok: true, inscription };
}

/** Build the 22 systematic bytes for an inscription (throws on invalid text). */
export function buildPayload(text: string): number[] {
  if (!/^[A-Z0-9-]{1,20}$/.test(text)) {
    throw new Error(`buildPayload: invalid inscription ${JSON.stringify(text)}`);
  }
  const data = new Array<number>(DATA_BYTES).fill(0);
  data[0] = text.length;
  for (let i = 0; i < text.length; i++) data[1 + i] = text.charCodeAt(i);
  return data;
}

// ---------------------------------------------------------------------------
// Full-grid decoding. Failure reports carry no payload bytes whatsoever, so
// a partial inscription can never leak through the UI.
// ---------------------------------------------------------------------------

export interface Correction {
  /** Byte index 0..29 in row-major order. */
  index: number;
  /** 0-based row of the byte's first cell in the decoded orientation. */
  row: number;
  /** 0-based column of the byte's first cell in the decoded orientation. */
  col: number;
  before: number;
  after: number;
}

export type DecodeReport =
  | {
      ok: true;
      inscription: string;
      /** 30 bytes as read from the grid (may contain errors). */
      received: number[];
      /** 30 bytes of the recovered codeword. */
      corrected: number[];
      corrections: Correction[];
    }
  | { ok: false; reason: 'marker'; expected: string; actual: string }
  | { ok: false; reason: 'uncorrectable' }
  | { ok: false; reason: 'payload'; error: PayloadError };

/** Decode the grid exactly as it is currently oriented. */
export function decodeGrid(g: Grid): DecodeReport {
  const actual = markerBits(g);
  if (actual !== MARKER) {
    return { ok: false, reason: 'marker', expected: MARKER, actual };
  }
  const received = gridToBytes(g);
  const decoded = decodeBounded(received);
  if (!decoded.ok) {
    return { ok: false, reason: 'uncorrectable' };
  }
  const payload = parsePayload(decoded.corrected.slice(0, DATA_BYTES));
  if (!payload.ok) {
    return { ok: false, reason: 'payload', error: payload.error };
  }
  const corrections: Correction[] = decoded.errorPositions.map((index) => ({
    index,
    ...byteCell(index),
    before: received[index],
    after: decoded.corrected[index],
  }));
  return {
    ok: true,
    inscription: payload.inscription,
    received,
    corrected: decoded.corrected,
    corrections,
  };
}
