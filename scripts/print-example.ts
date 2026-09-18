/**
 * Prints the worked example used in README.md: a valid 16x16 grid for a
 * sample inscription, plus the same grid with four correctable bit flips.
 * Run with: npm run example
 */
import { MARKER, buildPayload, bytesToGrid, byteCell, type Grid } from '../src/lib/codec';
import { encodeSystematic } from '../src/lib/rs';

const INSCRIPTION = 'STELE-7NORTH-GATE';

function printGrid(g: Grid): void {
  for (const row of g) {
    console.log(row.map((filled) => (filled ? '1' : '0')).join(''));
  }
}

const payload = buildPayload(INSCRIPTION);
const code = encodeSystematic(payload);

console.log(`铭文: ${INSCRIPTION}`);
console.log(`标记行: ${MARKER}`);
console.log();
console.log('30 字节码字（十六进制，前 22 字节系统数据 + 后 8 字节校验）:');
console.log(code.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
console.log();
console.log('完整 16×16 点阵（第 1 行为标记行）:');
const grid = bytesToGrid(code);
printGrid(grid);
console.log();

// Four bit flips in four distinct bytes -> still uniquely decodable.
const flips: Array<[number, number]> = [
  [2, 4], // byte 2
  [6, 10], // byte 10
  [10, 1], // byte 18
  [14, 13], // byte 27
];
console.log('演示纠错：翻转以下 4 格（行,列，1 起计）后仍可唯一释读:');
for (const [r, c] of flips) {
  // 1-based (row, col); data rows start at row 2, so byte = ((r-2)*16 + (c-1)) / 8
  const byteIndex = Math.floor(((r - 2) * 16 + (c - 1)) / 8);
  console.log(`  行 ${r} 列 ${c}（字节 ${byteIndex}）`);
}
const corrupted = grid.map((row) => row.slice());
for (const [r, c] of flips) corrupted[r - 1][c - 1] = !corrupted[r - 1][c - 1];
console.log();
console.log('翻转后的 16×16 点阵:');
printGrid(corrupted);
console.log();
console.log('各字节起始格位（行,列，0 起计）:');
console.log(
  Array.from({ length: 30 }, (_, k) => {
    const { row, col } = byteCell(k);
    return `${k}:(${row},${col})`;
  }).join(' '),
);
