import { useCallback, useState } from 'react';
import {
  MARKER,
  byteCell,
  decodeGrid,
  emptyGrid,
  rotateCW,
  type DecodeReport,
  type Grid,
} from './lib/codec';
import { CODE_BYTES } from './lib/rs';

function hex(v: number): string {
  return '0x' + v.toString(16).toUpperCase().padStart(2, '0');
}

const PAYLOAD_MESSAGES: Record<string, string> = {
  length: '载荷非法：长度字节不在 1–20 范围内',
  character: '载荷非法：内容含非法字符（仅允许 A–Z、0–9 与连字符）',
  padding: '载荷非法：声明长度之后未以 0x00 填满',
  terminator: '载荷非法：固定终止字节不是 0x00',
};

export default function App() {
  const [grid, setGrid] = useState<Grid>(() => emptyGrid());
  const [report, setReport] = useState<DecodeReport | null>(null);

  const toggleCell = useCallback((r: number, c: number) => {
    setGrid((g) => {
      const next = g.map((row) => row.slice());
      next[r][c] = !next[r][c];
      return next;
    });
    setReport(null); // evidence must always match the grid on screen
  }, []);

  const rotate = useCallback(() => {
    setGrid((g) => rotateCW(g));
    setReport(null);
  }, []);

  const clear = useCallback(() => {
    setGrid(emptyGrid());
    setReport(null);
  }, []);

  const decode = useCallback(() => {
    setReport(decodeGrid(grid));
  }, [grid]);

  return (
    <main className="app">
      <h1>点阵铭牌释读台</h1>
      <p className="hint">
        点击格位涂黑 / 留白；顶行为标记行（不参与纠错），须等于 <code>{MARKER}</code>。
        若铭牌被倒置拍录，请用旋转按钮调整朝向后再释读——只检查当前朝向。
      </p>

      <div className="grid" role="grid" aria-label="16×16 点阵">
        {grid.map((row, r) =>
          row.map((filled, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              role="gridcell"
              data-testid={`cell-${r}-${c}`}
              aria-label={`第${r + 1}行第${c + 1}列`}
              aria-pressed={filled}
              className={
                'cell' + (filled ? ' filled' : '') + (r === 0 ? ' marker' : '')
              }
              onClick={() => toggleCell(r, c)}
            />
          )),
        )}
      </div>

      <div className="toolbar">
        <button type="button" data-testid="rotate" onClick={rotate}>
          顺时针旋转 90°
        </button>
        <button type="button" data-testid="decode" className="primary" onClick={decode}>
          释读
        </button>
        <button type="button" data-testid="clear" onClick={clear}>
          清空
        </button>
      </div>

      <section aria-live="polite" className="result" data-testid="result">
        {report === null && <p className="muted">尚未释读。</p>}
        {report !== null && !report.ok && report.reason === 'marker' && (
          <div role="alert" data-testid="decode-error" className="error">
            <p>标记行错误：顶行不等于 {MARKER}。</p>
            <p>
              期望 <code>{report.expected}</code>，实际 <code>{report.actual}</code>
              。请检查朝向或顶行污损。
            </p>
          </div>
        )}
        {report !== null && !report.ok && report.reason === 'uncorrectable' && (
          <div role="alert" data-testid="decode-error" className="error">
            <p>污损过重：错误字节超过可纠正上限（4 字节），无法唯一恢复。</p>
          </div>
        )}
        {report !== null && !report.ok && report.reason === 'payload' && (
          <div role="alert" data-testid="decode-error" className="error">
            <p>{PAYLOAD_MESSAGES[report.error]}</p>
          </div>
        )}
        {report !== null && report.ok && (
          <div data-testid="decode-success" className="success">
            <h2>
              铭文：<output data-testid="inscription">{report.inscription}</output>
            </h2>
            <p data-testid="correction-count">
              {report.corrections.length === 0
                ? '码字无错误，无需纠正。'
                : `已按有界距离解码纠正 ${report.corrections.length} 个字节（上限 4）。`}
            </p>
            {report.corrections.length > 0 && (
              <table data-testid="corrections" className="bytes">
                <thead>
                  <tr>
                    <th>字节序号</th>
                    <th>行</th>
                    <th>列</th>
                    <th>纠正前</th>
                    <th>纠正后</th>
                  </tr>
                </thead>
                <tbody>
                  {report.corrections.map((c) => (
                    <tr key={c.index} className="fixed">
                      <td>{c.index}</td>
                      <td>{c.row + 1}</td>
                      <td>
                        {c.col + 1}–{c.col + 8}
                      </td>
                      <td>{hex(c.before)}</td>
                      <td>{hex(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <table data-testid="byte-map" className="bytes">
              <caption>全部 30 字节（行、列为当前解码朝向中的格位，1 起计）</caption>
              <thead>
                <tr>
                  <th>字节序号</th>
                  <th>行</th>
                  <th>列</th>
                  <th>纠正前</th>
                  <th>纠正后</th>
                </tr>
              </thead>
              <tbody>
                {report.corrected.map((after, k) => {
                  const { row, col } = byteCell(k);
                  const changed = report.received[k] !== after;
                  return (
                    <tr key={k} className={changed ? 'fixed' : ''}>
                      <td>{k}</td>
                      <td>{row + 1}</td>
                      <td>
                        {col + 1}–{col + 8}
                      </td>
                      <td>{hex(report.received[k])}</td>
                      <td>{hex(after)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted">
              共 {CODE_BYTES} 字节：前 22 字节为系统数据，后 8 字节为校验。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
