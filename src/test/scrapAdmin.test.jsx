import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import PDashboard from '../pages/PDashboard.jsx';
import { buildScrapChart, bestByItem, scrapChartTitle, MAX_SERIES } from '../lib/scrapChart.js';
import { today } from '../lib/format.js';

const price = (date, buyer, item, rate) => ({ date, buyer, item, rate });
const NAMES = { B1: 'Alpha Traders', B2: 'Beta Metals' };
const labelOf = (id) => NAMES[id] || id;

describe('bestByItem', () => {
  it('picks the highest rate per item and remembers who offered it', () => {
    const best = bestByItem([price('d', 'B1', 'PET', 30), price('d', 'B2', 'PET', 42), price('d', 'B1', 'ALU', 90)]);
    expect(best.PET).toEqual({ rate: 42, buyer: 'B2' });
    expect(best.ALU).toEqual({ rate: 90, buyer: 'B1' });
  });
  it('is empty for no rows', () => expect(bestByItem([])).toEqual({}));
});

describe('buildScrapChart — series grouping', () => {
  const rows = [
    price('2026-08-01', 'B1', 'PET', 30), price('2026-08-05', 'B1', 'PET', 34),
    price('2026-08-01', 'B2', 'PET', 28), price('2026-08-05', 'B2', 'PET', 40),
    price('2026-08-01', 'B1', 'ALU', 90),
  ];

  it('returns null when there is nothing to plot', () => {
    expect(buildScrapChart([], {})).toBeNull();
    expect(buildScrapChart(rows, { itemFil: 'NOPE' })).toBeNull();
  });

  it('groups by BUYER by default, labelling series with the buyer name', () => {
    const c = buildScrapChart(rows, { labelOf });
    expect(c.perItem).toBe(false);
    expect(c.series.map((s) => s.label).sort()).toEqual(['Alpha Traders', 'Beta Metals']);
  });

  it('groups by ITEM when a buyer is chosen but no item', () => {
    const c = buildScrapChart(rows, { buyerFil: 'B1', labelOf });
    expect(c.perItem).toBe(true);
    expect(c.series.map((s) => s.label).sort()).toEqual(['ALU', 'PET']);
  });

  it('groups by buyer again once an item is also chosen', () => {
    const c = buildScrapChart(rows, { buyerFil: 'B1', itemFil: 'PET', labelOf });
    expect(c.perItem).toBe(false);
    expect(c.series.map((s) => s.label)).toEqual(['Alpha Traders']);
  });

  it('tooltips name the same series as the legend, with a formatted date', () => {
    const c = buildScrapChart(rows, { itemFil: 'PET', labelOf });
    const alpha = c.series.find((s) => s.label === 'Alpha Traders');
    // dd/mm/yyyy — this app's fmtDate convention throughout, rather than the
    // monolith's "01 Aug 2026"; deliberate, see MIGRATION.md.
    expect(alpha.points[0].tip).toBe('Alpha Traders — ₹30.00 on 01/08/2026');
  });

  it('plots points in date order and draws a path through them', () => {
    const c = buildScrapChart(rows, { itemFil: 'PET', labelOf });
    const alpha = c.series.find((s) => s.label === 'Alpha Traders');
    expect(alpha.points.map((p) => p.date)).toEqual(['2026-08-01', '2026-08-05']);
    expect(alpha.path).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
    expect(alpha.points[0].x).toBeLessThan(alpha.points[1].x);
  });

  it('puts a higher rate higher on the canvas (y grows downward)', () => {
    const c = buildScrapChart([price('2026-08-01', 'B1', 'PET', 10), price('2026-08-02', 'B1', 'PET', 90)], { itemFil: 'PET', labelOf });
    const [lo, hi] = c.series[0].points;
    expect(hi.y).toBeLessThan(lo.y);
  });

  it('caps the plot at 6 series and flags the truncation', () => {
    const many = Array.from({ length: 9 }, (_, i) => price('2026-08-01', 'B' + i, 'PET', 10 + i));
    const c = buildScrapChart(many, { labelOf });
    expect(c.series).toHaveLength(MAX_SERIES);
    expect(c.truncated).toBe(true);
    expect(buildScrapChart(many.slice(0, 3), { labelOf }).truncated).toBe(false);
  });

  it('still plots a single flat point without collapsing the scale', () => {
    const c = buildScrapChart([price('2026-08-01', 'B1', 'PET', 50)], { labelOf });
    expect(c.series[0].points).toHaveLength(1);
    expect(Number.isFinite(c.series[0].points[0].y)).toBe(true);
  });
});

describe('scrapChartTitle', () => {
  it('names the item, else the buyer, else all buyers', () => {
    expect(scrapChartTitle({ labelOf })).toBe('Scrap price trend — all buyers');
    expect(scrapChartTitle({ buyerFil: 'B1', labelOf })).toBe('Items from Alpha Traders');
    expect(scrapChartTitle({ buyerFil: 'B1', itemFil: 'PET', labelOf })).toBe('Price trend — PET');
  });
});

describe('P Dashboard — Scrap tab board and trend chart', () => {
  const modules = {
    purchase: { asl: [], pos: [] },
    scrap: {
      buyers: [{ id: 'B1', name: 'Alpha Traders' }, { id: 'B2', name: 'Beta Metals' }],
      prices: [
        price(today(), 'B1', 'PET', 30),
        price(today(), 'B2', 'PET', 42),
        price('2026-08-01', 'B1', 'PET', 25),
        price(today(), 'B1', 'ALU', 90),
      ],
      txns: [],
      items: ['PET', 'ALU'],
    },
  };

  async function openScrap() {
    renderApp(<PDashboard />, { modules, role: 'padmin' });
    await waitFor(() => expect(screen.getByText(/Scrap Details/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Scrap Details/));
  }

  it('stars the best rate per item on the board for today', async () => {
    await openScrap();
    const card = screen.getByText(/Today's Buying Prices/).closest('.card');
    const rows = within(card).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const starred = rows.filter((r) => within(r).queryByText('★ best'));
    expect(starred).toHaveLength(2);
    // PET: Beta pays 42 vs Alpha's 30, so Beta carries the star. ALU has a
    // single offer, so Alpha carries that one. Rows sort by buyer name.
    const cells = (r) => [...r.querySelectorAll('td')].map((td) => td.textContent.trim());
    expect(starred.map(cells).map((c) => [c[0], c[1]])).toEqual([
      ['Alpha Traders', 'ALU'],
      ['Beta Metals', 'PET'],
    ]);
    // The losing PET quote is present but unstarred.
    const alphaPet = rows.map(cells).find((c) => c[0] === 'Alpha Traders' && c[1] === 'PET');
    expect(alphaPet[3]).toBe('');
  });

  it('renders the trend chart and retitles it as filters narrow', async () => {
    await openScrap();
    expect(screen.getByText(/Scrap Price Trends/)).toBeInTheDocument();
    expect(screen.getByText('Scrap price trend — all buyers')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /price trend/i })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by buyer'), 'B1');
    expect(screen.getByText('Items from Alpha Traders')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by item'), 'PET');
    expect(screen.getByText('Price trend — PET')).toBeInTheDocument();
  });

  it('shows the empty note when a filter matches no price points', async () => {
    await openScrap();
    await userEvent.selectOptions(screen.getByLabelText('Filter by buyer'), 'B2');
    await userEvent.selectOptions(screen.getByLabelText('Filter by item'), 'ALU');
    expect(screen.getByText(/No price points yet/)).toBeInTheDocument();
  });
});
