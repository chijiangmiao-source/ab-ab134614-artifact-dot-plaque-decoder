import type { Page } from '@playwright/test';
import {
  buildPayload,
  bytesToGrid,
  rotateCW,
  type Grid,
} from '../src/lib/codec';
import { encodeSystematic } from '../src/lib/rs';

export const INSCRIPTION = 'STELE-7NORTH-GATE';

/** A valid grid (marker row + RS codeword) for the sample inscription. */
export function validGrid(): Grid {
  return bytesToGrid(encodeSystematic(buildPayload(INSCRIPTION)));
}

/**
 * Paint a grid onto the page by clicking every filled cell. The app starts
 * with an all-empty grid, so each filled cell needs exactly one click.
 * Clicks go through the app's own button handlers.
 */
export async function paint(page: Page, grid: Grid): Promise<void> {
  const cells: Array<[number, number]> = [];
  grid.forEach((row, r) =>
    row.forEach((filled, c) => {
      if (filled) cells.push([r, c]);
    }),
  );
  await clickCells(page, cells);
}

/** Toggle specific cells (0-based row/col) through the app's cell buttons. */
export async function clickCells(page: Page, cells: Array<[number, number]>): Promise<void> {
  await page.evaluate((list) => {
    for (const [r, c] of list) {
      const el = document.querySelector<HTMLButtonElement>(
        `[data-testid="cell-${r}-${c}"]`,
      );
      if (!el) throw new Error(`cell ${r}-${c} not found`);
      el.click();
    }
  }, cells);
}

export { rotateCW };
