// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { _, C_, compilePluralForms, ngettext, setCatalog } from './i18n.ts';

afterEach(() => setCatalog(null));

describe('i18n', () => {
  it('returns the msgid without a catalog', () => {
    expect(_('Rectangle')).toBe('Rectangle');
    expect(ngettext('%d object', '%d objects', 2)).toBe('%d objects');
  });

  it('translates plain, context and plural messages', () => {
    setCatalog({
      pluralForms: 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
      messages: {
        Rectangle: 'Prostokąt',
        'Object\u0004Fill': 'Wypełnienie',
        '%d object': ['%d obiekt', '%d obiekty', '%d obiektów'],
        Untranslated: '',
      },
    });
    expect(_('Rectangle')).toBe('Prostokąt');
    expect(C_('Object', 'Fill')).toBe('Wypełnienie');
    expect(_('Fill')).toBe('Fill');
    expect(_('Untranslated')).toBe('Untranslated');
    expect([1, 3, 5, 22].map((n) => ngettext('%d object', '%d objects', n))).toEqual([
      '%d obiekt',
      '%d obiekty',
      '%d obiektów',
      '%d obiekty',
    ]);
  });

  it('rejects plural expressions with unexpected characters', () => {
    const f = compilePluralForms('nplurals=2; plural=alert(1);');
    expect([f(1), f(2)]).toEqual([0, 1]);
  });
});
