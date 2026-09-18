import { describe, expect, it } from 'vitest';
import {
  GRID_SIZE,
  MARKER,
  buildPayload,
  byteCell,
  bytesToGrid,
  decodeGrid,
  emptyGrid,
  gridToBytes,
  markerBits,
  parsePayload,
  rotateCW,
  type Grid,
} from '../src/lib/codec';
import { encodeSystematic } from '../src/lib/rs';

const TEXT = 'STELE-7NORTH-GATE';

function validGrid(): Grid {
  return bytesToGrid(encodeSystematic(buildPayload(TEXT)));
}

function flip(g: Grid, r: number, c: number): Grid {
  const next = g.map((row) => row.slice());
  next[r][c] = !next[r][c];
  return next;
}

describe('点阵映射', () => {
  it('标记行为 1011001011100001', () => {
    expect(MARKER).toBe('1011001011100001');
    expect(MARKER.length).toBe(GRID_SIZE);
  });

  it('行优先、每八位高位在前组成 30 字节', () => {
    const g = emptyGrid();
    // 第 2 行（行号 1）前两字节：0b10100000 与 0b00000011
    g[1][0] = true;
    g[1][2] = true;
    g[1][14] = true;
    g[1][15] = true;
    const bytes = gridToBytes(g);
    expect(bytes.length).toBe(30);
    expect(bytes[0]).toBe(0b10100000);
    expect(bytes[1]).toBe(0b00000011);
    // 字节 k 位于第 1+k/2 行、列 (k%2)*8
    expect(byteCell(0)).toEqual({ row: 1, col: 0 });
    expect(byteCell(1)).toEqual({ row: 1, col: 8 });
    expect(byteCell(29)).toEqual({ row: 15, col: 8 });
  });

  it('bytesToGrid 与 gridToBytes 互逆，标记行不参与数据', () => {
    const code = encodeSystematic(buildPayload(TEXT));
    const g = bytesToGrid(code);
    expect(markerBits(g)).toBe(MARKER);
    expect(gridToBytes(g)).toEqual(code);
    // 改动标记行不影响提取出的数据字节
    const g2 = flip(g, 0, 0);
    expect(gridToBytes(g2)).toEqual(code);
    expect(markerBits(g2)).not.toBe(MARKER);
  });
});

describe('顺时针旋转 90°', () => {
  it('旋转四次回到原样', () => {
    let g = validGrid();
    const original = g;
    for (let i = 0; i < 4; i++) g = rotateCW(g);
    expect(g).toEqual(original);
  });

  it('(r,c) 旋转后落在 (c, 15−r)，顶行移到最右列', () => {
    const g = emptyGrid();
    g[2][3] = true;
    const once = rotateCW(g);
    expect(once[3][GRID_SIZE - 1 - 2]).toBe(true);
    // 顶行标记旋转后出现在最右列（自上而下）
    const marked = validGrid();
    const rotated = rotateCW(marked);
    for (let c = 0; c < GRID_SIZE; c++) {
      expect(rotated[c][GRID_SIZE - 1]).toBe(MARKER[c] === '1');
    }
    // 旋转后顶行不再是标记，释读只检查当前朝向
    const report = decodeGrid(rotated);
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.reason).toBe('marker');
  });
});

describe('载荷校验', () => {
  it('接受 1–20 长度的合法铭文', () => {
    expect(parsePayload(buildPayload('A'))).toEqual({ ok: true, inscription: 'A' });
    expect(parsePayload(buildPayload('ABC-123'))).toEqual({
      ok: true,
      inscription: 'ABC-123',
    });
    expect(parsePayload(buildPayload('Z'.repeat(20)))).toEqual({
      ok: true,
      inscription: 'Z'.repeat(20),
    });
  });

  it('拒绝越界长度', () => {
    const zero = buildPayload('A');
    zero[0] = 0;
    expect(parsePayload(zero)).toEqual({ ok: false, error: 'length' });
    const big = buildPayload('A');
    big[0] = 21;
    expect(parsePayload(big)).toEqual({ ok: false, error: 'length' });
  });

  it('拒绝非法字符（小写、空格、符号）', () => {
    for (const bad of [0x61, 0x20, 0x2e, 0x5f, 0x00]) {
      const data = buildPayload('ABC');
      data[2] = bad;
      expect(parsePayload(data)).toEqual({ ok: false, error: 'character' });
    }
  });

  it('拒绝长度后未填 0x00 与终止字节非零', () => {
    const pad = buildPayload('ABC');
    pad[10] = 0x41; // 声明长度 3 之外的非零内容
    expect(parsePayload(pad)).toEqual({ ok: false, error: 'padding' });
    const term = buildPayload('ABC');
    term[21] = 0x01;
    expect(parsePayload(term)).toEqual({ ok: false, error: 'terminator' });
  });

  it('buildPayload 拒绝非法铭文文本', () => {
    expect(() => buildPayload('')).toThrow();
    expect(() => buildPayload('abc')).toThrow();
    expect(() => buildPayload('A'.repeat(21))).toThrow();
    expect(() => buildPayload('HELLO WORLD')).toThrow();
  });
});

describe('整格释读', () => {
  it('合法码字成功并给出空纠正表', () => {
    const report = decodeGrid(validGrid());
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.inscription).toBe(TEXT);
      expect(report.corrections).toEqual([]);
      expect(report.received).toEqual(report.corrected);
    }
  });

  it('4 字节污损可纠正，并报告当前朝向的行列格位', () => {
    let g = validGrid();
    // 污损字节 0（行1列1-8）、字节 9（行5列9-16）、字节 21（行11列9-16）、字节 29（行15列9-16）
    g = flip(g, 1, 3);
    g = flip(g, 5, 9);
    g = flip(g, 11, 12);
    g = flip(g, 15, 15);
    const report = decodeGrid(g);
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.inscription).toBe(TEXT);
      expect(report.corrections.map((c) => c.index)).toEqual([0, 9, 21, 29]);
      expect(report.corrections[0]).toMatchObject({ row: 1, col: 0 });
      expect(report.corrections[1]).toMatchObject({ row: 5, col: 8 });
      expect(report.corrections[2]).toMatchObject({ row: 11, col: 8 });
      expect(report.corrections[3]).toMatchObject({ row: 15, col: 8 });
      for (const c of report.corrections) {
        expect(c.before).not.toBe(c.after);
        expect(report.received[c.index]).toBe(c.before);
        expect(report.corrected[c.index]).toBe(c.after);
      }
    }
  });

  it('标记行错误：只报告标记，不携带任何数据字节', () => {
    const g = flip(validGrid(), 0, 5);
    const report = decodeGrid(g);
    expect(report).toEqual({
      ok: false,
      reason: 'marker',
      expected: MARKER,
      actual: markerBits(g),
    });
    expect(report).not.toHaveProperty('inscription');
    expect(report).not.toHaveProperty('corrected');
  });

  it('污损过重（5 字节）：报告不可纠正，不泄露铭文', () => {
    let g = validGrid();
    const spots: Array<[number, number]> = [
      [1, 0],
      [3, 4],
      [6, 2],
      [9, 10],
      [13, 5],
    ];
    for (const [r, c] of spots) g = flip(g, r, c);
    const report = decodeGrid(g);
    expect(report).toEqual({ ok: false, reason: 'uncorrectable' });
    expect(report).not.toHaveProperty('inscription');
  });

  it('载荷非法：只报告确定错误类别，不泄露部分铭文', () => {
    // 长度字节为 0 的“合法码字”（伴随式为零但载荷非法）
    const bad = new Array(22).fill(0);
    const g = bytesToGrid(encodeSystematic(bad));
    const report = decodeGrid(g);
    expect(report).toEqual({ ok: false, reason: 'payload', error: 'length' });
    expect(report).not.toHaveProperty('inscription');
    expect(report).not.toHaveProperty('received');
  });
});
