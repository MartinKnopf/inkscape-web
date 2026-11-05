// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-output.cpp, src/io/file-export-cmd.cpp
// @vitest-environment happy-dom
import { SPDocument } from '@inkscape-web/core';
import type { Rect } from '@inkscape-web/geom';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PovOutput } from '../extension/internal/pov-out.ts';
import { Svg } from '../extension/internal/svg.ts';
import { InkscapeApplication } from '../inkscape-application.ts';
import { ExportAreaType, InkFileExportCmd } from '../io/file-export-cmd.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="50">' +
  '<rect id="r1" x="10" y="10" width="20" height="10" style="fill:#ff0000;stroke:none"/>' +
  '<rect id="r2" inkscape:label="two" x="60" y="20" width="30" height="20" style="fill:#0000ff;stroke:none"/>' +
  '</svg>';

const app = InkscapeApplication.instance();
const run = (action: string) => expect(app.activate_action(action)).toBe(true);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

beforeAll(() => {
  Svg.init();
  PovOutput.init();
});

beforeEach(() => {
  // A new set of settings for each test: the application keeps one.
  const fresh = new InkFileExportCmd();
  for (const key of Object.keys(fresh) as (keyof InkFileExportCmd)[]) {
    (app.file_export() as unknown as Record<string, unknown>)[key] = fresh[key];
  }
});

describe('app.export-* actions', () => {
  it('set the options of the export, with the types of the parameters', () => {
    const cmd = app.file_export();
    run("app.export-type('pdf,png')");
    run("app.export-filename('out')");
    run('app.export-overwrite(true)');
    run('app.export-margin(5)');
    run('app.export-dpi(192.5)');
    run("app.export-area('0:0:10:10')");
    run("app.export-png-color-mode('Gray_8')");
    expect([
      cmd.export_type,
      cmd.export_filename,
      cmd.export_overwrite,
      cmd.export_margin,
      cmd.export_dpi,
    ]).toEqual(['pdf,png', 'out', true, 5, 192.5]);
    expect([cmd.export_area_type, cmd.export_area, cmd.export_png_color_mode]).toEqual([
      ExportAreaType.Area,
      '0:0:10:10',
      'Gray_8',
    ]);
    // A parameter of another type does not run the action
    expect(app.activate_action("app.export-margin('x')")).toBe(false);
    // export-area-drawing(false) leaves the area type
    run('app.export-area-drawing(false)');
    expect(cmd.export_area_type).toBe(ExportAreaType.Area);
  });

  it('export-do exports the active document to on_files', async () => {
    const doc = SPDocument.createNewDocFromMem(SVG)!;
    doc.documentFilename = 'drawing.svg';
    const desktopStub = {
      getDocument: () => doc,
      getSelection: () => null,
      connectDocumentReplaced: () => () => {},
    } as never;
    app.set_active_desktop(desktopStub);
    try {
      const files = await new Promise<{ name: string; data: Uint8Array }[]>((resolve) => {
        app.file_export().on_files = resolve;
        run("app.export-type('svg')");
        run('app.export-do');
      });
      expect(files.map((f) => f.name)).toEqual(['drawing_out.svg']);
      expect(text(files[0]!.data)).toContain('id="r2"');
    } finally {
      app.set_active_desktop(null);
    }
  });
});

describe('InkFileExportCmd', () => {
  async function export_files(setup: (cmd: InkFileExportCmd) => void, name = 'drawing.svg') {
    const cmd = new InkFileExportCmd();
    setup(cmd);
    await cmd.do_export(SPDocument.createNewDocFromMem(SVG)!, name);
    return cmd.take_files();
  }

  it('exports one object and hides the others; the name has the id', async () => {
    const files = await export_files((c) => {
      c.export_type = 'svg';
      c.export_id = 'r1';
      c.export_id_only = true;
    });
    expect(files.map((f) => f.name)).toEqual(['drawing_r1.svg']);
    const svg = text(files[0]!.data);
    expect(svg).toContain('id="r1"');
    expect(svg).not.toContain('id="r2"');
    // The page is the drawing area of the object: 20 x 10
    expect(svg).toMatch(/width="20"/);
    expect(svg).toMatch(/height="10"/);
  });

  it('exports plain SVG without Inkscape attributes, with the area, margin and snap', async () => {
    const files = await export_files((c) => {
      c.export_plain_svg = true;
      c.set_export_area('59.5:19.5:90:40');
      c.export_area_snap = true;
      c.export_margin = 2;
      c.export_filename = 'part';
      c.export_type = 'svg';
    });
    expect(files.map((f) => f.name)).toEqual(['part.svg']);
    const svg = text(files[0]!.data);
    expect(svg).not.toContain('inkscape:label');
    // snapped outwards to 59:19..90:40 and 2 px more on all sides: 35 x 25
    expect(svg).toMatch(/width="35"/);
    expect(svg).toMatch(/height="25"/);
  });

  it('exports the drawing area', async () => {
    const files = await export_files((c) => c.set_export_area_type(ExportAreaType.Drawing));
    // from (10, 10) to (90, 40)
    expect(text(files[0]!.data)).toMatch(/width="80"/);
  });

  it('uses an output extension of the file type, and its file name', async () => {
    const files = await export_files((c) => {
      c.export_type = 'pov';
    });
    expect(files.map((f) => f.name)).toEqual(['drawing.pov']);
    expect(text(files[0]!.data)).toContain('#declare r1 = prism {');
  });

  it('takes the type from the extension of the file name, and several types from a list', async () => {
    const files = await export_files((c) => {
      c.export_filename = 'many.pov';
    });
    expect(files.map((f) => f.name)).toEqual(['many.pov']);
    const both = await export_files((c) => {
      c.export_type = 'svg;pov';
    });
    expect(both.map((f) => f.name)).toEqual(['drawing_out.svg', 'drawing.pov']);
  });

  it('writes a message for an unknown type', async () => {
    const cmd = new InkFileExportCmd();
    cmd.export_type = 'xyz';
    await cmd.do_export(SPDocument.createNewDocFromMem(SVG)!, 'drawing.svg');
    expect(cmd.take_files()).toEqual([]);
    expect(cmd.messages[0]).toMatch(/Unknown export type: xyz\. Allowed values: \[.*pov.*svg.*\]/);
  });

  describe('PNG', () => {
    let calls: { area: Rect; width: number; height: number; background: string | undefined }[] = [];
    beforeEach(() => {
      calls = [];
      InkFileExportCmd.render_png = async (_doc, area, width, height, options) => {
        calls.push({ area, width, height, background: options.background?.toString() });
        return new Uint8Array([0x89, 0x50]);
      };
    });

    it('sizes the bitmap by the dpi, and the area by the page', async () => {
      const files = await export_files((c) => {
        c.export_type = 'png';
        c.export_dpi = 192;
      });
      expect(files.map((f) => f.name)).toEqual(['drawing.png']);
      expect([calls[0]?.width, calls[0]?.height]).toEqual([200, 100]);
    });

    it('sizes the bitmap by width or height, and the id gives the area of the object', async () => {
      await export_files((c) => {
        c.export_type = 'png';
        c.export_id = 'r2';
        c.export_width = 90;
      });
      // r2 is 30 x 20 px: 90 px wide is 3x, so 60 px high
      expect([calls[0]?.width, calls[0]?.height]).toEqual([90, 60]);
      // the document is fitted to the object, so the area starts at the origin
      expect([calls[0]?.area.left(), calls[0]?.area.width()]).toEqual([0, 30]);
    });

    it('uses the background color and opacity of the options', async () => {
      await export_files((c) => {
        c.export_type = 'png';
        c.export_background = '#ff0000';
        c.export_background_opacity = 128;
      });
      expect(calls[0]?.background).toBe('#ff000080');
    });

    it('exports each of the pages as a file', async () => {
      const cmd = new InkFileExportCmd();
      cmd.export_type = 'png';
      cmd.export_page = 'all';
      const doc = SPDocument.createNewDocFromMem(
        SVG.replace(
          '<rect id="r1"',
          '<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><inkscape:page id="p1" x="0" y="0" width="50" height="50"/><inkscape:page id="p2" x="60" y="0" width="40" height="50"/></sodipodi:namedview><rect id="r1"',
        ),
      )!;
      await cmd.do_export(doc, 'drawing.svg');
      expect(cmd.take_files().map((f) => f.name)).toEqual(['drawing_p1.png', 'drawing_p2.png']);
      expect(calls.map((c) => [c.width, c.height])).toEqual([
        [50, 50],
        [40, 50],
      ]);
    });

    it('rejects values out of range and a wrong color mode', async () => {
      const files = await export_files((c) => {
        c.export_type = 'png';
        c.export_png_color_mode = 'Purple_3';
      });
      expect(files).toEqual([]);
      const dpi = await export_files((c) => {
        c.export_type = 'png';
        c.export_dpi = 20000;
      });
      expect(dpi).toEqual([]);
      expect(calls).toEqual([]);
    });
  });
});
