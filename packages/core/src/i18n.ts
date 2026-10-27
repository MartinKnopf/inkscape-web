// SPDX-License-Identifier: GPL-2.0-or-later
// Gettext-style translation helpers with the same names and msgids as upstream
// (glibmm/i18n.h: _(), C_(), N_(), NC_(), ngettext()). Catalogs are generated
// from upstream po/*.po by @inkscape-web/assets.

/** JSON catalog as written by packages/assets (one file per language). */
export interface Catalog {
  /** Value of the PO "Plural-Forms" header, e.g. "nplurals=2; plural=(n != 1);". */
  pluralForms: string;
  /** Key: msgid, or msgctxt + "\u0004" + msgid. Value: msgstr, or msgstr[] for plurals. */
  messages: Record<string, string | string[]>;
}

const CONTEXT_SEPARATOR = '\u0004';

let messages: Record<string, string | string[]> = {};
let pluralIndex: (n: number) => number = (n) => (n === 1 ? 0 : 1);

/** Activate a catalog. Pass null to return to the untranslated (English) strings. */
export function setCatalog(catalog: Catalog | null): void {
  messages = catalog?.messages ?? {};
  pluralIndex = catalog ? compilePluralForms(catalog.pluralForms) : (n) => (n === 1 ? 0 : 1);
}

/** Translate a message. */
export function _(msgid: string): string {
  const t = messages[msgid];
  return typeof t === 'string' && t ? t : msgid;
}

/** Translate a message with a context (upstream C_("context", "msgid")). */
export function C_(context: string, msgid: string): string {
  const t = messages[context + CONTEXT_SEPARATOR + msgid];
  return typeof t === 'string' && t ? t : msgid;
}

/** Mark a message for extraction; translate it later with _(). */
export function N_(msgid: string): string {
  return msgid;
}

/** Mark a message with a context for extraction; translate it later with C_(). */
export function NC_(_context: string, msgid: string): string {
  return msgid;
}

/** Translate a message with plural forms. */
export function ngettext(msgid: string, msgidPlural: string, n: number): string {
  const t = messages[msgid];
  if (Array.isArray(t)) {
    const s = t[pluralIndex(n)];
    if (s) return s;
  }
  return n === 1 ? msgid : msgidPlural;
}

/**
 * Turn a Plural-Forms header into a function. The expression uses C syntax,
 * which is also valid JavaScript. Only a fixed set of characters is accepted,
 * so the catalog cannot run other code.
 */
export function compilePluralForms(header: string): (n: number) => number {
  const expr = /plural\s*=\s*([^;]+)/.exec(header)?.[1]?.trim();
  if (!expr || !/^[n0-9\s()?:<>=!&|%+-]+$/.test(expr)) return (n) => (n === 1 ? 0 : 1);
  const f = new Function('n', `return Number(${expr});`) as (n: number) => number;
  return (n) => f(n);
}
