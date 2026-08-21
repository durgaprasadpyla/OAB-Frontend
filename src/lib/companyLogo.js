// Bloomflex company mark used on the printed TAX INVOICE header.
//
// In OAB-App this is `reference/logo-datauri.txt`, injected by build.js as
// `window.__OAB_LOGO__` and emitted by renderInvoiceDoc() as the only thing in
// `.inv-top` above the address block. That file is byte-identical to
// `login-logo-datauri.txt`, which this app already ships as [LOGIN_LOGO], so the
// invoice re-uses it rather than carrying a second 75 KB copy of the same PNG.
export { LOGIN_LOGO as COMPANY_LOGO } from './loginLogo.js';
