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
