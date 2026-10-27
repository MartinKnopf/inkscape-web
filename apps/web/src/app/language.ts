// SPDX-License-Identifier: GPL-2.0-or-later
// Pick and load the UI language. Catalogs come from @inkscape-web/assets (po/<lang>.json).
import { type Catalog, setCatalog } from '@inkscape-web/core';

interface Manifest {
  upstreamCommit: string;
  languages: string[];
}

/**
 * Match a BCP 47 tag ("pt-BR") to an upstream catalog name ("pt_BR", else "pt").
 * Returns null for English or when no catalog exists.
 */
export function matchLanguage(tag: string, available: string[]): string | null {
  const [lang = '', region] = tag.split('-');
  const candidates = region ? [`${lang}_${region.toUpperCase()}`, lang] : [lang];
  return candidates.find((c) => available.includes(c)) ?? null;
}

/** Load the catalog for ?lang=xx or the browser language. Returns the active language. */
export async function loadLanguage(): Promise<string> {
  const manifest: Manifest = await (await fetch('/manifest.json')).json();
  const wanted = new URLSearchParams(location.search).get('lang') ?? navigator.language;
  const lang = matchLanguage(wanted, manifest.languages);
  if (!lang) return 'en';
  const catalog: Catalog = await (await fetch(`/po/${lang}.json`)).json();
  setCatalog(catalog);
  return lang;
}
