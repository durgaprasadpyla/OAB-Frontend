import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Layout regressions are invisible to jsdom (it does no real layout), so these
// assert the CSS contract that prevents them instead.
//
// The bug this guards: `grid-template-columns: 1fr 1fr 1fr` gives each track an
// implicit `min-width: auto`, so a track can never shrink below its content's
// min-content width. A <select> holding long option text (spec and SKU names run
// to ~880px) therefore forced its column wide and pushed the whole card past the
// viewport on FG Entry.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('form grids can shrink', () => {
  it('every .gN track is minmax(0,1fr), never a bare 1fr', () => {
    const rules = css.split('\n').filter((l) => /^\s*\.g[234]\b|^\s*\.g[234],/.test(l) && /grid-template-columns/.test(l));
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((r) => {
      expect(r, `bare 1fr track will not shrink: ${r.trim()}`).not.toMatch(/grid-template-columns\s*:\s*(1fr[\s,]*)+;?\s*(gap|})/);
      expect(r, `missing minmax(0,...): ${r.trim()}`).toMatch(/minmax\(0/);
    });
  });

  it('grid children and .fg wrappers may shrink below their content', () => {
    // min-width:0 on the control alone is not enough — the grid ITEM is the
    // wrapper, and that is what the track measures.
    expect(css).toMatch(/\.g2>\*,\.g3>\*,\.g4>\*\{min-width:0\}/);
    expect(css).toMatch(/\.fg\{[^}]*min-width:0/);
  });

  it('keeps the monolith rule that lets controls shrink too', () => {
    expect(css).toMatch(/select,\s*input,\s*textarea\s*\{[^}]*min-width:\s*0/);
  });
});

// Issues 3.0 §3. `.cb` is the 14x14 CHECKBOX rule, but several screens put it on the
// <label> wrapping the box (sales-user module allocation, Daily Board, Master Data).
// A 14x14 label cannot hold its caption, so the text spilled over the tick and the
// module list was unreadable. jsdom does no layout, so assert the CSS contract.
describe('checkbox rows stay legible', () => {
  it('a label carrying .cb is a row, not a 14px box', () => {
    const rule = css.split('\n').find((l) => l.startsWith('label.cb{'));
    expect(rule, 'no label.cb rule — .cb would squeeze the caption onto the tick').toBeTruthy();
    expect(rule).toMatch(/width:auto/);
    expect(rule).toMatch(/height:auto/);
    expect(rule).toMatch(/display:inline-flex/);
    expect(rule).toMatch(/white-space:nowrap/);
  });

  it('the box inside such a label keeps its own 14px size', () => {
    const rule = css.split('\n').find((l) => l.startsWith('label.cb>input{'));
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/width:14px/);
    expect(rule).toMatch(/height:14px/);
    expect(rule).toMatch(/flex:none/);
  });

  it('the sales-user module allocation panel is a grid with room per column', () => {
    const rule = css.split('\n').find((l) => l.startsWith('.mod-alloc{'));
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/display:grid/);
    expect(rule).toMatch(/minmax\(150px/);
  });
});
