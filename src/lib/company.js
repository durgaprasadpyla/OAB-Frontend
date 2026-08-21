// Seller constants, extracted from the legacy invoice template (renderInvoiceDoc).
// Place of supply in Telangana (state code 36) => CGST+SGST, otherwise IGST.
export const COMPANY = {
  name: 'BLOOMFLEX PRIVATE LIMITED',
  addressLines: ['Hyderabad Road, Nizamabad,', 'Telangana, India'],
  gstin: '36AAGCB0700P1ZQ',
  state: 'Telangana',
  stateCode: '36',
  email: 'accounts@bloomflex.com',
  web: 'bloomflex.com',
  hsn: '3923',
  bank: 'UNION BANK OF INDIA | A/C NO: 059613100002023 | IFSC: UBIN0805963 | BRANCH: HYDERABAD ROAD, NIZAMABAD',
  declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Goods once sold will not be taken back. Subject to Nizamabad jurisdiction. E&OE',
};

// ── Printed TAX INVOICE constants ─────────────────────────────────────────────
// Verbatim from renderInvoiceDoc() in the production monolith. The invoice is the
// one artefact a customer and an auditor both read, so every string here is a copy
// of what production prints — do not "tidy" them.
export const INVOICE_DOC = {
  // The four copies named down the top-right corner of the sheet.
  copies: ['Original for Buyer', 'Duplicate for Transporter', 'Triplicate for Assessee', 'Extra Copy'],
  // The registered office / works / statutory line under the logo.
  addressLines: [
    'Regd Off: Plot#8-2-2682020A, Vivekananda Enclave, Sagar Society, Road No:3, Banjara Hills, Hyderabad-500 034.',
    'Works By: Sy.No.586/Part, Dundigal Village, Dundigal Gandimysamma Mandal, Medchal Dist, Hyderabad, T.S-500 043',
    'CIN - U21098TG2014PTC095995 | MSME REG NO: TS02C0003505 | Ph: 7670821491 to 493 | ops@bloomflex.com, accounts@bloomflex.com',
  ],
  // The HSN printed on every line. Production prints the 8-digit code, not '3923'.
  hsn: '39206939',
  declarations: [
    'I/We declare that this invoice shows actual price of the goods and/or services described and that all particulars are true and correct',
    'There might be a variation of 10% in quantity mentioned in the PO',
    'Subject to the jurisdiction of courts in Hyderabad',
  ],
};

// Purchase-Order issuer block. The PO template uses the registered Banjara Hills
// office and the Dundigal plant as the delivery point — deliberately different
// from the invoice's Nizamabad addresses above. (pvBuildPODocHTML 7010)
export const PO_ISSUER = {
  name: 'BLOOMFLEX PRIVATE LIMITED',
  address: '8-2-268/V/20/20A, ROAD NO 3, BANJARA HILLS, HYDERABAD - 500 034',
  gstin: '36AAGCB0700P1ZQ',
  pan: 'AAGCB0700P',
  billing: [
    'M/s. Bloomflex Private Limited',
    'Plot#8-2-268/V/20/20A',
    'Road No: 3, Banjara Hills',
    'Hyderabad, Telangana - 500 034',
    'GST NO: 36AAGCB0700P1ZQ',
    'PAN: AAGCB0700P',
  ],
  delivery: [
    'M/s. Bloomflex Private Limited',
    'Survey No.586 to 589/Part',
    'Dundigal Village, Near SGS Ashram',
    'Dundigal Gandimysamma Mandal',
    'Medchal Malkajgiri District, Telangana-500043',
  ],
};
