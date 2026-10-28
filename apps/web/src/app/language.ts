// SPDX-License-Identifier: GPL-2.0-or-later
// Pick and load the UI language. Catalogs come from @inkscape-web/assets (po/<lang>.json).
import { type Catalog, Preferences, setCatalog } from '@inkscape-web/core';

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

/** The catalog names (upstream po file names) that exist. */
export async function availableLanguages(): Promise<string[]> {
  const manifest: Manifest = await (await fetch('/manifest.json')).json();
  return manifest.languages;
}

/**
 * Load the catalog for ?lang=xx, else the preference /ui/language (an upstream
 * catalog name like "pt_BR"; empty is the system default), else the browser
 * language. Returns the active language.
 */
export async function loadLanguage(): Promise<string> {
  const available = await availableLanguages();
  const pref = Preferences.get().getString('/ui/language');
  const wanted = new URLSearchParams(location.search).get('lang') ?? (pref || navigator.language);
  const lang = available.includes(wanted) ? wanted : matchLanguage(wanted.replace('_', '-'), available);
  if (!lang) return 'en';
  const catalog: Catalog = await (await fetch(`/po/${lang}.json`)).json();
  setCatalog(catalog);
  return lang;
}
