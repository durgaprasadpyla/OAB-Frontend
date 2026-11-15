import { afterEach, describe, expect, it } from 'vitest';
import { guardNumberWheel } from '../lib/numberWheel.js';

describe('mouse wheel over a number box (invoice qty 20,400 became 20,399)', () => {
  let stop = () => {};
  afterEach(() => { stop(); document.body.innerHTML = ''; });

  it('takes the cursor out of the number box being edited, so the wheel cannot step it', () => {
    stop = guardNumberWheel(document);
    document.body.innerHTML = '<input type="number" id="q" value="20400" />';
    const q = document.getElementById('q');
    q.focus();
    expect(document.activeElement).toBe(q);
    q.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    expect(document.activeElement).not.toBe(q);
    expect(q.value).toBe('20400');
  });

  it('leaves a focused number box alone when the wheel turns elsewhere on the page', () => {
    stop = guardNumberWheel(document);
    document.body.innerHTML = '<input type="number" id="q" value="5" /><div id="list">rows</div>';
    const q = document.getElementById('q');
    q.focus();
    document.getElementById('list').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    expect(document.activeElement).toBe(q);
  });

  it('does not touch text boxes', () => {
    stop = guardNumberWheel(document);
    document.body.innerHTML = '<input type="text" id="t" value="abc" />';
    const t = document.getElementById('t');
    t.focus();
    t.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    expect(document.activeElement).toBe(t);
  });
});
