// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/template.cpp, src/extension/internal/template-base.cpp, src/extension/internal/template-paper.cpp, src/extension/internal/template-from-file.cpp, src/ui/widget/template-list.cpp
import { SPDocument } from '@inkscape-web/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sp_file_template_filename, sp_file_template_svg } from '../file.ts';
import { TemplateList } from '../ui/widget/template-list.ts';
import { db } from './db.ts';
import { Script } from './implementation/script.ts';
import { TemplateFromFile } from './internal/template-from-file.ts';
import { TemplateOther } from './internal/template-other.ts';
import { TemplatePaper } from './internal/template-paper.ts';
import { TemplateScreen } from './internal/template-screen.ts';
import { TemplateSocial } from './internal/template-social.ts';
import { TemplateVideo } from './internal/template-video.ts';
import { INKSCAPE_EXTENSION_URI } from './prefdialog/widget.ts';
import { build_from_mem } from './system.ts';
import { Template, TemplateVisibility } from './template.ts';

const DEFAULT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
  'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="210mm" height="297mm" viewBox="0 0 210 297">' +
  '<sodipodi:namedview id="base" inkscape:document-units="mm"/></svg>';

const USER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="50" height="50">' +
  '<inkscape:templateinfo><inkscape:name>My card</inkscape:name><inkscape:shortdesc>For cards</inkscape:shortdesc>' +
  '<inkscape:priority>5</inkscape:priority></inkscape:templateinfo></svg>';

const preset = (key: string) => {
  const p = Template.get_any_preset(key);
  if (!p) throw new Error(`no preset ${key}`);
  return p;
};

beforeAll(() => {
  TemplatePaper.init();
  TemplateOther.init();
  TemplateScreen.init();
  TemplateSocial.init();
  TemplateVideo.init();
  TemplateFromFile.init();
});

beforeEach(() => {
  Template.files.clear();
  Template.files.set('default.svg', DEFAULT_SVG);
});

describe('template presets', () => {
  it('reads the presets of the inx, with the visibility and the sort order', () => {
    const paper = db.get('org.inkscape.template.paper') as Template;
    expect(paper.get_category()).toBe('Print');
    const icons = paper.get_presets(TemplateVisibility.TEMPLATE_NEW_ICON).map((p) => p.get_name());
    // icon visibility, in order of the priorities -110 to -107; A0 to A5 and others are "all" (255) too
    expect(icons.slice(0, 4)).toEqual([
      'A4 (Portrait)',
      'A4 (Landscape)',
      'US Letter (Portrait)',
      'US Letter (Landscape)',
    ]);
    // "search" only: A4 and US Letter are in the list, A6 is not visible at all
    const a6 = paper.get_preset('org.inkscape.template.paper.a6');
    expect(a6?.get_visibility()).toBe(TemplateVisibility.TEMPLATE_SIZE_SEARCH);
    expect(Template.parse_visibility('list,search')).toBe(12);
    expect(Template.parse_visibility('both')).toBe(0);
    expect(paper.can_resize()).toBe(true);
  });

  it('matches the size of a page, also rotated', () => {
    const a4 = Template.get_any_preset(793.7, 1122.5);
    expect(a4?.get_name()).toBe('A4');
    expect(Template.get_any_preset(1122.5, 793.7)?.get_name()).toBe('A4');
    expect(Template.get_any_preset(1, 1)).toBeNull();
  });
});

describe('new documents from templates', () => {
  it('sets the size, the unit and the scale of the template (A4 landscape)', async () => {
    const doc = await preset('org.inkscape.template.paper.a4 (landscape)').new_from_template();
    expect(doc).not.toBeNull();
    const root = doc!.getReprRoot();
    expect(root.attribute('width')).toBe('297mm');
    expect(root.attribute('height')).toBe('210mm');
    // the scale is 1 user unit per px, so the viewBox has the size in px
    const [, , w, h] = root.attribute('viewBox')!.split(' ').map(Number);
    expect(w).toBeCloseTo(1122.52, 1);
    expect(h).toBeCloseTo(793.7, 1);
    expect(doc!.getNamedView().getAttribute('inkscape:document-units')).toBe('mm');
    expect(doc!.modifiedSinceSave).toBe(false);
  });

  it('uses the unit of the preset (US Letter, in)', async () => {
    const doc = await preset('org.inkscape.template.paper.us letter (portrait)').new_from_template();
    expect(doc!.getReprRoot().attribute('width')).toBe('8.5in');
    expect(doc!.getReprRoot().attribute('height')).toBe('11in');
  });

  it('makes square icons and keeps the width and height of the other templates', async () => {
    const icon = await preset('org.inkscape.template.other.icon 32x32').new_from_template();
    expect(icon!.getReprRoot().attribute('width')).toBe('32');
    expect(icon!.getReprRoot().attribute('height')).toBe('32');
    const video = await preset('org.inkscape.template.video.video hd 1080p').new_from_template();
    expect(video!.getReprRoot().attribute('width')).toBe('1920');
    expect(video!.getReprRoot().attribute('height')).toBe('1080');
    expect(Template.get_any_preset('org.inkscape.template.social.instagram square')).not.toBeNull();
    expect(Template.get_any_preset('org.inkscape.template.digital.desktop 4k')).not.toBeNull();
  });

  it('resizes the page of a document to the template', async () => {
    const doc = SPDocument.createNewDocFromMem(DEFAULT_SVG)!;
    await preset('org.inkscape.template.paper.a5').resize_to_template(doc, null);
    expect(doc.getDimensions().x).toBeCloseTo(559.37, 1);
    expect(doc.getDimensions().y).toBeCloseTo(793.7, 1);
  });
});

describe('templates from files', () => {
  it('makes a preset for each template file with its template info', async () => {
    Template.files.set('my_card.svg', USER_SVG);
    Template.files.set('icons/custom.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const from_file = db.get('org.inkscape.template.from-file') as Template;
    const presets = from_file.get_presets();
    expect(presets.map((p) => p.get_key())).toEqual(['my_card.svg']);
    const [p] = presets;
    expect(p?.get_name()).toBe('My card');
    expect(p?.get_description()).toBe('For cards');
    expect(p?.get_label()).toBe('Custom Template');
    expect(p?.get_sort_priority()).toBe(5);
    expect(p?.get_visibility()).toBe(TemplateVisibility.TEMPLATE_NEW_ICON);
    const doc = await p!.new_from_template();
    expect(doc?.getDimensions().x).toBe(50);
  });

  it('names a file without template info after the file', () => {
    Template.files.set('plain_file.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const p = (db.get('org.inkscape.template.from-file') as Template).get_presets()[0];
    expect(p?.get_name()).toBe('plain-file ');
  });
});

describe('script templates', () => {
  it('runs the script with the parameters of the preset and the template file', async () => {
    let seen: { params: readonly string[]; input: string | null } | null = null;
    Script.runner = {
      async execute(_command, params, input) {
        seen = { params, input: input ? new TextDecoder().decode(input) : null };
        return { stdout: new TextEncoder().encode(DEFAULT_SVG.replace('210mm', '85mm')), stderr: '' };
      },
    };
    const mod = build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}"><name>Business Card</name><id>org.inkscape.template.test_card</id>` +
        '<category context="TemplateCategory">Print</category>' +
        '<param name="size" gui-text="Size" type="optiongroup" appearance="combo"><option value="a">A</option><option value="74mmx52mm">B</option></param>' +
        '<template icon="x"><preset name="Card" label="Various" visibility="icon"/></template>' +
        '<script><command location="inx" interpreter="python">template.py</command></script></inkscape-extension>',
    ) as Template;
    try {
      expect(mod).toBeInstanceOf(Template);
      const doc = await mod.get_preset('org.inkscape.template.test_card.card')!.new_from_template();
      expect(doc?.getReprRoot().attribute('width')).toBe('85mm');
      expect(seen!.params).toEqual(['--size=a']);
      expect(seen!.input).toBe(DEFAULT_SVG);
    } finally {
      Script.runner = null;
    }
  });
});

describe('template list', () => {
  it('has a page for each category in order of the extensions, items sorted by priority, and one with all templates', () => {
    Template.files.set('my_card.svg', USER_SVG);
    const list = new TemplateList(TemplateVisibility.TEMPLATE_NEW_FROM);
    expect(list.pages.map((p) => p.name)).toEqual([
      'All templates',
      'Print',
      'Other',
      'Screen',
      'Social',
      'Video',
      'Custom',
    ]);
    const print = list.items('Print');
    expect(print[0]?.name).toBe('A4 (Portrait)');
    expect(print[0]?.label).toBe('210 × 297 mm');
    expect(print[0]?.icon).toBe('/share/templates/icons/print_portrait.svg');
    expect(list.items('All templates').length).toBeGreaterThan(print.length);
    expect(list.items('Print', 'letter').map((i) => i.name)).toEqual([
      'US Letter (Portrait)',
      'US Letter (Landscape)',
    ]);
  });

  it('lists the custom templates after the placeholder for a new one', () => {
    Template.files.set('my_card.svg', USER_SVG);
    const list = new TemplateList(TemplateVisibility.TEMPLATE_NEW_FROM, 'custom');
    expect(list.pages.map((p) => p.name)).toEqual(['Custom']);
    expect(list.items('Custom').map((i) => i.key)).toEqual(['-new-template-', 'my_card.svg']);
  });

  it('makes a document of a key', async () => {
    const doc = await TemplateList.new_document('org.inkscape.template.video.video hd 720p');
    expect(doc?.getReprRoot().attribute('width')).toBe('1280');
    expect(await TemplateList.new_document('unknown')).toBeNull();
  });
});

describe('save as template', () => {
  it('writes the template info into the saved file only', () => {
    const doc = SPDocument.createNewDocFromMem(DEFAULT_SVG)!;
    const text = sp_file_template_svg(doc, 'My card', '', 'For cards', 'a, b', new Date(2026, 10, 5))!;
    expect(text).toContain('<inkscape:templateinfo>\n    <inkscape:name>My card</inkscape:name>');
    expect(text).toContain('<inkscape:shortdesc>For cards</inkscape:shortdesc>');
    expect(text).toContain('<inkscape:date>2026-11-05</inkscape:date>');
    expect(text).toContain('<inkscape:keywords>a, b</inkscape:keywords>');
    expect(text).not.toContain('inkscape:author');
    expect([...doc.getReprRoot().children()].some((c) => c.name() === 'inkscape:templateinfo')).toBe(false);
    expect(sp_file_template_svg(doc, '', '', '', '')).toBeNull();
    expect(sp_file_template_filename('A/b c é')).toBe('A%2Fb c é.svg');
  });

  it('can be loaded as a template again', () => {
    const doc = SPDocument.createNewDocFromMem(DEFAULT_SVG)!;
    Template.files.set('mine.svg', sp_file_template_svg(doc, 'Mine', '', 'Short', '')!);
    const p = (db.get('org.inkscape.template.from-file') as Template).get_presets()[0];
    expect(p?.get_name()).toBe('Mine');
    expect(p?.get_description()).toBe('Short');
  });
});
