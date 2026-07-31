import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks these browser bits — stub so screens and export code don't crash.
window.print = () => {};
window.scrollTo = () => {};
globalThis.confirm = () => true;   // close/delete confirmations proceed in tests
globalThis.alert = () => {};

// CDN globals used by the Excel/PDF helpers.
window.XLSX = {
  utils: {
    aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {},
    sheet_to_json: () => [],
  },
  writeFile: () => {},
  read: () => ({ SheetNames: ['s'], Sheets: { s: {} } }),
};
window.jspdf = {
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    addImage() {} addPage() {} save() {}
  },
};
window.html2canvas = async () => ({ width: 800, height: 1000, toDataURL: () => 'data:image/png;base64,AAAA' });

if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

afterEach(() => cleanup());
