import { api } from '../api.js';

// BloomFlex V2 roll stickers. Kept out of src/api.js so this branch merges cleanly.
export const rollStickerApi = {
  /** One roll by its internal code (BLMU-n) — a scanned sticker, or a sticker reprint with the CURRENT quantity. */
  unitByCode: (code) => api('/api/stores/units/by-code/' + encodeURIComponent(String(code ?? '').trim())),
};
