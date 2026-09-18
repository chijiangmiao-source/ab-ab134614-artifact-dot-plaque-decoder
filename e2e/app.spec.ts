import { expect, test } from '@playwright/test';
import { INSCRIPTION, clickCells, paint, rotateCW, validGrid } from './helpers';
import { bytesToGrid } from '../src/lib/codec';
import { encodeSystematic } from '../src/lib/rs';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('编辑：点击格位可涂黑再留白', async ({ page }) => {
  const cell = page.getByTestId('cell-5-3');
  await expect(cell).toHaveAttribute('aria-pressed', 'false');
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await expect(cell).toHaveClass(/filled/);
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'false');
  await expect(cell).not.toHaveClass(/filled/);
});

test('旋转：顺时针 90° 把 (r,c) 送到 (c,15−r)，四次复原', async ({ page }) => {
  await page.getByTestId('cell-2-3').click();
  await page.getByTestId('rotate').click();
  await expect(page.getByTestId('cell-3-13')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('cell-2-3')).toHaveAttribute('aria-pressed', 'false');
  for (let i = 0; i < 3; i++) await page.getByTestId('rotate').click();
  await expect(page.getByTestId('cell-2-3')).toHaveAttribute('aria-pressed', 'true');
});

test('旋转：倒置拍录的铭牌转两次后可释读', async ({ page }) => {
  // 铭牌被倒置（旋转 180°）拍录：先确认当前朝向无法释读
  const upsideDown = rotateCW(rotateCW(validGrid()));
  await paint(page, upsideDown);
  await page.getByTestId('decode').click();
  await expect(page.getByTestId('decode-error')).toContainText('标记行错误');
  await expect(page.getByTestId('inscription')).toHaveCount(0);

  // 顺时针转两次恢复朝向，再释读成功
  await page.getByTestId('rotate').click();
  await page.getByTestId('rotate').click();
  await page.getByTestId('decode').click();
  await expect(page.getByTestId('inscription')).toHaveText(INSCRIPTION);
});

test('成功释读：4 字节污损被纠正并给出格位证据', async ({ page }) => {
  await paint(page, validGrid());
  // 翻转 4 个不同字节中的各一位（README 同款示例：字节 0、9、16、25）
  await clickCells(page, [
    [1, 3],
    [5, 9],
    [9, 0],
    [13, 12],
  ]);
  await page.getByTestId('decode').click();

  await expect(page.getByTestId('decode-success')).toBeVisible();
  await expect(page.getByTestId('inscription')).toHaveText(INSCRIPTION);
  await expect(page.getByTestId('correction-count')).toContainText('4');

  const corrections = page.getByTestId('corrections');
  await expect(corrections.locator('tbody tr')).toHaveCount(4);
  // 字节 0 位于第 2 行第 1–8 列（1 起计）：0x11 被污损为 0x01，已纠正回 0x11
  const firstRow = corrections.locator('tbody tr').first();
  await expect(firstRow.locator('td').nth(0)).toHaveText('0');
  await expect(firstRow.locator('td').nth(1)).toHaveText('2');
  await expect(firstRow.locator('td').nth(2)).toHaveText('1–8');
  await expect(firstRow.locator('td').nth(3)).toHaveText('0x01');
  await expect(firstRow.locator('td').nth(4)).toHaveText('0x11');

  // 全部 30 字节的纠正前后对照表
  await expect(page.getByTestId('byte-map').locator('tbody tr')).toHaveCount(30);
});

test('失败抑制：标记行错误时不泄露铭文', async ({ page }) => {
  const grid = validGrid();
  grid[0][5] = !grid[0][5]; // 弄污标记行
  await paint(page, grid);
  await page.getByTestId('decode').click();
  await expect(page.getByTestId('decode-error')).toContainText('标记行错误');
  await expect(page.getByTestId('inscription')).toHaveCount(0);
  await expect(page.getByText(INSCRIPTION)).toHaveCount(0);
  await expect(page.getByTestId('byte-map')).toHaveCount(0);
});

test('失败抑制：污损过重时不泄露铭文', async ({ page }) => {
  await paint(page, validGrid());
  // 5 个不同字节各翻一位，超出 4 字节纠错半径
  await clickCells(page, [
    [1, 0],
    [3, 4],
    [6, 2],
    [9, 10],
    [13, 5],
  ]);
  await page.getByTestId('decode').click();
  await expect(page.getByTestId('decode-error')).toContainText('污损过重');
  await expect(page.getByTestId('inscription')).toHaveCount(0);
  await expect(page.getByText(INSCRIPTION)).toHaveCount(0);
});

test('失败抑制：载荷非法时不泄露部分铭文', async ({ page }) => {
  // 长度字节为 25（越界）但校验正确的“合法码字”
  const badPayload = [25, ...new Array<number>(21).fill(0)];
  await paint(page, bytesToGrid(encodeSystematic(badPayload)));
  await page.getByTestId('decode').click();
  await expect(page.getByTestId('decode-error')).toContainText('载荷非法');
  await expect(page.getByTestId('inscription')).toHaveCount(0);
  await expect(page.getByTestId('byte-map')).toHaveCount(0);
});
