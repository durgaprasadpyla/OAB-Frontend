import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readAttachment, readAttachments, MAX_PDF_BYTES } from '../lib/attach.js';
import { PurchaseOrderDoc, poTotals } from '../components/PurchaseOrderDoc.jsx';

/** A File stub good enough for the FileReader paths under test. */
function fakeFile(name, type, size = 10) {
  return { name, type, size };
}

// jsdom has no real FileReader decoding or canvas; stub both so the attachment
// pipeline can be exercised end to end.
beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.FileReader = class {
    readAsDataURL(file) {
      this.result = 'data:' + (file.type || 'application/octet-stream') + ';base64,AAAA';
      setTimeout(() => this.onload && this.onload({ target: { result: this.result } }), 0);
    }
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,SMALL');
  // Image: report a wide source so the downscale path actually engages.
  globalThis.Image = class {
    constructor() { this.width = 4000; this.height = 2000; setTimeout(() => this.onload && this.onload(), 0); }
    set src(_v) { /* triggered by the constructor timer above */ }
  };
});

describe('readAttachment', () => {
  it('keeps a small PDF as-is', async () => {
    const doc = await readAttachment(fakeFile('cert.pdf', 'application/pdf', 1000));
    expect(doc).toMatchObject({ name: 'cert.pdf', type: 'pdf' });
    expect(doc.data).toMatch(/^data:application\/pdf/);
    expect(doc.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects a PDF over the size cap, since it cannot be compressed here', async () => {
    await expect(readAttachment(fakeFile('big.pdf', 'application/pdf', MAX_PDF_BYTES + 1)))
      .rejects.toThrow(/larger than 1.5MB/);
  });

  it('downscales and re-encodes an image as JPEG', async () => {
    const doc = await readAttachment(fakeFile('photo.png', 'image/png', 9e6));
    expect(doc).toMatchObject({ name: 'photo.png', type: 'image' });
    // Re-encoded, not the original bytes — this is what keeps the blob small.
    expect(doc.data).toBe('data:image/jpeg;base64,SMALL');
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.6);
  });

  it('caps the downscale at 1000px wide, preserving aspect ratio', async () => {
    const canvas = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
      const c = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
      canvas.push(c);
      c.getContext = () => ({ drawImage: () => {} });
      c.toDataURL = () => 'data:image/jpeg;base64,SMALL';
      return c;
    });
    await readAttachment(fakeFile('wide.jpg', 'image/jpeg'));
    expect(canvas[0].width).toBe(1000);      // 4000 -> 1000
    expect(canvas[0].height).toBe(500);      // aspect ratio held
  });

  it('refuses anything that is not an image or a PDF', async () => {
    await expect(readAttachment(fakeFile('notes.docx', 'application/msword')))
      .rejects.toThrow(/only images and PDFs/);
  });
});

describe('readAttachments — batch', () => {
  it('keeps what works and reports what did not, rather than failing the batch', async () => {
    const { docs, errors } = await readAttachments([
      fakeFile('ok.pdf', 'application/pdf', 100),
      fakeFile('bad.docx', 'application/msword'),
      fakeFile('big.pdf', 'application/pdf', MAX_PDF_BYTES + 1),
    ]);
    expect(docs.map((d) => d.name)).toEqual(['ok.pdf']);
    expect(errors).toHaveLength(2);
  });

  it('tolerates an empty or absent list', async () => {
    expect((await readAttachments([])).docs).toEqual([]);
    expect((await readAttachments(undefined)).docs).toEqual([]);
  });
});

describe('poTotals', () => {
  const po = {
    poNum: 'BLM/PUR/26-27/101', supplier: 'Acme Films', gstPercent: 18,
    items: [{ item: 'BOPP 20mic', unit: 'Kg', qty: 100, rate: 120, amount: 12000 },
      { item: 'Ink', unit: 'Kg', qty: 10, rate: 500, amount: 5000 }],
  };
  const asl = [{ company: 'Acme Films', address: 'Plot 1', gstn: '36AAA', phone: '99999' }];

  it('sums the lines and applies GST', () => {
    const t = poTotals(po, asl);
    expect(t.subTotal).toBe(17000);
    expect(t.gstAmt).toBe(3060);
    expect(t.grandTotal).toBe(20060);
  });

  it('resolves the supplier from the ASL', () => {
    expect(poTotals(po, asl).supplier.gstn).toBe('36AAA');
    expect(poTotals(po, []).supplier).toEqual({});
  });

  it('treats a PO with no items or no GST as zero, not NaN', () => {
    const t = poTotals({ items: [] }, []);
    expect(t.subTotal).toBe(0);
    expect(t.grandTotal).toBe(0);
    expect(poTotals({ items: [{ amount: 100 }] }, []).grandTotal).toBe(100);   // no gstPercent
  });
});

describe('PurchaseOrderDoc', () => {
  const po = {
    poNum: 'BLM/PUR/26-27/101', supplier: 'Acme Films', poDate: '2026-08-01',
    expectedDelivery: '2026-08-20', gstPercent: 18, notes: 'Deliver in one lot',
    items: [{ item: 'BOPP 20mic', unit: 'Kg', qty: 100, rate: 120, amount: 12000 }],
  };
  const asl = [{ company: 'Acme Films', address: 'Plot 1, Hyderabad', gstn: '36AAA', contact: 'Mr R' }];

  it('renders the order with supplier, lines and totals', () => {
    render(<PurchaseOrderDoc po={po} asl={asl} />);
    expect(screen.getByText('PURCHASE ORDER')).toBeInTheDocument();
    expect(screen.getByText(/PO No: BLM\/PUR\/26-27\/101/)).toBeInTheDocument();
    expect(screen.getByText(/M\/s\. Acme Films/)).toBeInTheDocument();
    expect(screen.getByText('Plot 1, Hyderabad')).toBeInTheDocument();
    expect(screen.getByText(/Kind Attention: Mr R/)).toBeInTheDocument();
    expect(screen.getByText('BOPP 20mic')).toBeInTheDocument();
    // One line of 12,000 => the same figure appears as the line amount and again
    // as the sub total.
    expect(screen.getAllByText('12,000.00')).toHaveLength(2);
    expect(screen.getByText(/14,160\.00/)).toBeInTheDocument();     // + 18% GST
  });

  it('spells the grand total in words', () => {
    render(<PurchaseOrderDoc po={po} asl={asl} />);
    expect(screen.getByText(/^RUPEES:/i)).toBeInTheDocument();
    expect(screen.getByText(/FOURTEEN THOUSAND/i)).toBeInTheDocument();
  });

  it('carries both the billing and the delivery address', () => {
    render(<PurchaseOrderDoc po={po} asl={asl} />);
    expect(screen.getByText('BILLING ADDRESS')).toBeInTheDocument();
    expect(screen.getByText('DELIVERY ADDRESS')).toBeInTheDocument();
    expect(screen.getByText(/Banjara Hills/)).toBeInTheDocument();
    expect(screen.getByText(/Dundigal Village/)).toBeInTheDocument();
  });

  it('shows the terms block, including the food-grade certificate requirement', () => {
    render(<PurchaseOrderDoc po={po} asl={asl} />);
    expect(screen.getByText(/TERMS & CONDITIONS/)).toBeInTheDocument();
    expect(screen.getByText(/Food grade certificates/i)).toBeInTheDocument();
  });

  it('omits the notes block when the PO has none', () => {
    render(<PurchaseOrderDoc po={{ ...po, notes: '' }} asl={asl} />);
    expect(screen.queryByText('Deliver in one lot')).not.toBeInTheDocument();
  });
});
