import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The alignment rules the whole application depends on, pinned in the stylesheet
// rather than screen by screen (2026-09-11). Each one was a visible fault:
//
//   * every filter bar mixed 30px boxes with 34px buttons, so the row was ragged
//     wherever a screen had both;
//   * a figures block with three tiles stretched each one to ~400px on a wide
//     screen, leaving the number marooned at the left edge of an empty box, while
//     five or more still had to share the row;
//   * the Stores filters and their three buttons could not fit one line, and the
//     buttons were splitting across two.

// vitest serves this file over http, so import.meta.url is not a file URL here.
const src = path.resolve(process.cwd(), 'src');
const css = fs.readFileSync(path.join(src, 'index.css'), 'utf8');
const stores = fs.readFileSync(path.join(src, 'pages', 'Stores.jsx'), 'utf8');

describe('layout rules that hold the app together', () => {
  it('gives filter-bar buttons the height of the boxes beside them', () => {
    const bar = /\.fbar input,\.fbar select\{height:(\d+)px/.exec(css);
    const btn = /\.fbar \.btn\{height:(\d+)px/.exec(css);
    expect(bar, '.fbar input/select height rule').toBeTruthy();
    expect(btn, '.fbar .btn height rule').toBeTruthy();
    expect(btn[1]).toBe(bar[1]);
  });

  it('keeps grouped bar actions together and pushed to the end', () => {
    expect(css).toMatch(/\.fbar-actions\{[^}]*margin-left:auto/);
    expect(stores).toContain('className="fbar-actions"');
  });

  it('caps figure tiles only while there are few of them', () => {
    // four or fewer: capped, so a tile never sprawls across the card
    const capped = /\.stats:not\(:has\(> :nth-child\(5\)\)\)\{grid-template-columns:repeat\(auto-fit,minmax\(150px,240px\)\)/.exec(css);
    expect(capped, 'small figure blocks are capped').toBeTruthy();
    // five or more: still share the row, as they always did
    expect(css).toMatch(/\.stats\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(120px,1fr\)\)/);
  });

  it('keeps the goods-receipt row inside a laptop screen', () => {
    const min = /minWidth: (\d+), tableLayout: 'fixed'/.exec(stores);
    expect(min, 'the receipt table declares a minimum width').toBeTruthy();
    expect(Number(min[1])).toBeLessThanOrEqual(1205);
  });
});
