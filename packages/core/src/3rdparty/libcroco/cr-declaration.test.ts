// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseDeclarationList } from './cr-declaration.ts';

const values = (text: string) => parseDeclarationList(text).map((d) => `${d.property}:${d.value}`);

describe('parseDeclarationList', () => {
  it('normalizes the values like libcroco', () => {
    expect(values('fill:rgb(100%,0%,100%);stroke:rgb( 255 , 0, 255 )')).toEqual([
      'fill:rgb(100%, 0%, 100%)',
      'stroke:rgb(255, 0, 255)',
    ]);
    expect(values('font-family:Arial,sans-serif;font:12px/24px  Foo')).toEqual([
      'font-family:Arial, sans-serif',
      'font:12px / 24px Foo',
    ]);
    expect(values('x:"a b";y:\'it\\\'s\';z:url( "#a" );w:url(#b)')).toEqual([
      "x:'a b'",
      'y:"it\'s"',
      'z:url(#a)',
      'w:url(#b)',
    ]);
    expect(values('a:+1.50;b:.5;c:-0.25px;d:1e3;e:10em;f:5%;g:1.0000000000000002')).toEqual([
      'a:1.5', // the sign of a number is part of the number
      'b:0.5',
      'c:-0.25px',
      'd:1000',
      'e:10em',
      'f:5%',
      'g:1',
    ]);
    expect(values('a:calc(1px+2px);b:#FFF;c:hsl(120, 50%, 50%)')).toEqual([
      'a:calc(1px 2px)', // the sign of a number is lost
      'b:#FFF',
      'c:hsl(120, 50%, 50%)',
    ]);
  });

  it('reads !important and ignores comments', () => {
    const decls = parseDeclarationList('/* c */ fill : red /* d */ ! important ; stroke:blue');
    expect(decls).toEqual([
      { property: 'fill', value: 'red', important: true },
      { property: 'stroke', value: 'blue', important: false },
    ]);
  });

  it('skips broken declarations up to the next semicolon', () => {
    expect(values('fill;stroke:red;;opacity:;x:1;y')).toEqual(['stroke:red', 'x:1']);
    expect(values('')).toEqual([]);
    expect(values(';;')).toEqual([]);
  });

  it('keeps the last declaration of a property in the list', () => {
    expect(values('fill:red;fill:blue')).toEqual(['fill:red', 'fill:blue']);
  });
});
