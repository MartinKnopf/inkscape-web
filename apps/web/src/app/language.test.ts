// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, it } from 'vitest';
import { matchLanguage } from './language.ts';

it('matches browser tags to upstream catalog names', () => {
  const available = ['de', 'pt', 'pt_BR', 'zh_CN'];
  expect(matchLanguage('de-AT', available)).toBe('de');
  expect(matchLanguage('pt-BR', available)).toBe('pt_BR');
  expect(matchLanguage('pt-PT', available)).toBe('pt');
  expect(matchLanguage('zh-CN', available)).toBe('zh_CN');
  expect(matchLanguage('en-US', available)).toBe(null);
});
