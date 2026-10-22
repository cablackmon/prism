import { JSDOM } from 'jsdom';

/** @param {string} html @param {(document: Document) => void} check @returns {void} */
export function withDocument(html, check) {
  const dom = new JSDOM(html);
  try { check(dom.window.document); } finally { dom.window.close(); }
}
