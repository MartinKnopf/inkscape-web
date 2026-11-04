// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/latex-text-renderer.cpp, src/extension/internal/latex-text-renderer.h
/*
 * Rendering LaTeX file (pdf/eps/ps+latex output)
 *
 * The idea stems from GNUPlot's epslatex terminal output :-)
 *
 * Authors:
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Miklos Erdelyi <erdelyim@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006-2011 Authors
 */
import { Affine, type Point, Scale, Translate } from '@inkscape-web/geom';
import { Color } from '../../colors/color.ts';
import { SpaceType } from '../../colors/spaces/enum.ts';
import type { SPDocument } from '../../document.ts';
import { Alignment } from '../../libnrtype/Layout-TNG.ts';
import { SPFlowtext } from '../../object/sp-flowtext.ts';
import { i2anc_affine, SPItem } from '../../object/sp-item.ts';
import { SPGroup } from '../../object/sp-item-group.ts';
import { SPRect } from '../../object/sp-rect.ts';
import { SPRoot } from '../../object/sp-root.ts';
import { SPText } from '../../object/sp-text.ts';
import { SPUse } from '../../object/sp-use.ts';
import type { SPStyle } from '../../style.ts';
import { SPCSSFontStyle, SPCSSFontWeight, SPTextAnchor } from '../../style-enums.ts';
import { SPCSSUnit } from '../../style-internal.ts';
import { DEFAULT_NUMERIC_PRECISION, formatFixed } from '../../svg/stringstream.ts';
import { stripTrailingZeros } from '../../svg/strip-trailing-zeros.ts';
import { convertUnit } from '../../svg/svg-length.ts';
import { sp_te_get_string_multiline, sp_te_style_at_position, te_get_layout } from '../../text-editing.ts';
import { inkscape_version } from './cairo-render-context.ts';

/**
 * A number as SVGOStringStream with std::ios::fixed writes it: integers as they are, others
 * with the numeric precision after the point and without trailing zeros.
 */
function num(d: number): string {
  if (Number.isInteger(d) && Math.abs(d) <= 0x7fffffff) return String(d === 0 ? 0 : d);
  return stripTrailingZeros(formatFixed(d, DEFAULT_NUMERIC_PRECISION));
}

const preamble =
  '%% To include the image in your LaTeX document, write\n' +
  '%%   \\input{<filename>.pdf_tex}\n' +
  '%%  instead of\n' +
  '%%   \\includegraphics{<filename>.pdf}\n' +
  '%% To scale the image, write\n' +
  '%%   \\def\\svgwidth{<desired width>}\n' +
  '%%   \\input{<filename>.pdf_tex}\n' +
  '%%  instead of\n' +
  '%%   \\includegraphics[width=<desired width>]{<filename>.pdf}\n' +
  '%%\n' +
  '%% Images with a different path to the parent latex file can\n' +
  "%% be accessed with the `import' package (which may need to be\n" +
  '%% installed) using\n' +
  '%%   \\usepackage{import}\n' +
  '%% in the preamble, and then including the image with\n' +
  '%%   \\import{<path to file>}{<filename>.pdf_tex}\n' +
  '%% Alternatively, one can specify\n' +
  '%%   \\graphicspath{{<path to file>/}}\n' +
  '%% \n' +
  '%% For more information, please see svg-inkscape on CTAN:\n' +
  '%%   https://ctan.org/pkg/svg-inkscape\n' +
  '%%\n' +
  '\\begingroup%\n' +
  '  \\makeatletter%\n' +
  '  \\providecommand\\color[2][]{%\n' +
  "    \\errmessage{(Inkscape) Color is used for the text in Inkscape, but the package 'color.sty' is not loaded}%\n" +
  '    \\renewcommand\\color[2][]{}%\n' +
  '  }%\n' +
  '  \\providecommand\\transparent[1]{%\n' +
  "    \\errmessage{(Inkscape) Transparency is used (non-zero) for the text in Inkscape, but the package 'transparent.sty' is not loaded}%\n" +
  '    \\renewcommand\\transparent[1]{}%\n' +
  '  }%\n' +
  '  \\providecommand\\rotatebox[2]{#2}%\n' +
  '  \\newcommand*\\fsize{\\dimexpr\\f@size pt\\relax}%\n' +
  '  \\newcommand*\\lineheight[1]{\\fontsize{\\fsize}{#1\\fsize}\\selectfont}%\n';

const postamble = '  \\end{picture}%\n' + '\\endgroup%\n';

enum OmitTextPageState {
  EMPTY,
  GRAPHIC_ON_TOP,
  NEW_PAGE_ON_GRAPHIC,
}

/** Whether the weight is bold for LaTeX (500 and above, bold, bolder). */
function isBold(style: SPStyle): boolean {
  const w = style.font_weight.computed;
  return (
    w >= 500 ||
    w === SPCSSFontWeight.SP_CSS_FONT_WEIGHT_BOLD ||
    w === SPCSSFontWeight.SP_CSS_FONT_WEIGHT_BOLDER
  );
}

/** The rotation of the item in the document in degrees (clockwise in LaTeX). */
function rotationDegrees(item: SPItem): number {
  const x = i2anc_affine(item, null).withoutTranslation().xAxis();
  return (-180 / Math.PI) * Math.atan2(x.y, x.x);
}

/** Writes the text of a document into a LaTeX picture (upstream LaTeXTextRenderer). */
export class LaTeXTextRenderer {
  _stream = '';
  _filename = '';
  readonly _pdflatex: boolean;
  _omittext_state = OmitTextPageState.EMPTY;
  _omittext_page = 1;
  readonly _transform_stack: Affine[] = [];

  constructor(pdflatex: boolean) {
    this._pdflatex = pdflatex;
    this.push_transform(Affine.identity());
  }

  /** Start the LaTeX file for the image file filename (upstream: opens "<filename>_tex"). */
  setTargetFile(filename: string): boolean {
    this._filename = filename.trim().split(/[\\/]/).pop() ?? filename;
    this._stream += `%% Creator: Inkscape ${inkscape_version.string}, www.inkscape.org\n`;
    this._stream += '%% PDF/EPS/PS + LaTeX output extension by Johan Engelen, 2010\n';
    this._stream += `%% Accompanies image file '${this._filename}' (pdf, eps, ps)\n`;
    this._stream += '%%\n';
    this.writePreamble();
    return true;
  }

  writePreamble(): void {
    this._stream += preamble;
  }

  writePostamble(): void {
    this._stream += postamble;
  }

  /** The LaTeX file (upstream: written by the destructor with the postamble). */
  finish(): string {
    this.writePostamble();
    return this._stream;
  }

  sp_group_render(group: SPGroup): void {
    for (const x of group.children) {
      if (x instanceof SPItem) this.renderItem(x);
    }
  }

  sp_use_render(use: SPUse): void {
    let translated = false;
    if ((use.x._set && use.x.computed !== 0) || (use.y._set && use.y.computed !== 0)) {
      this.push_transform(Translate(use.x.computed, use.y.computed));
      translated = true;
    }
    if (use.child) this.renderItem(use.child);
    if (translated) this.pop_transform();
  }

  /** The LaTeX of the spans of a text, with bold, italic, slanted, super- and subscript. */
  #spans(textobj: SPText | SPFlowtext, joinLines: (s: string) => string, skipNewline: boolean): string {
    let os = '';
    const layout = te_get_layout(textobj);
    if (!layout) return os;
    const le = layout.end();
    for (const li = layout.begin(); !li.equals(le); li.nextStartOfSpan()) {
      const ln = li.copy();
      ln.nextStartOfSpan();
      let spanstr = sp_te_get_string_multiline(textobj, li, ln);
      if (textobj instanceof SPText) {
        // escape ampersands and percent
        spanstr = spanstr.replace(/&/g, '\\&').replace(/%/g, '\\%');
      }

      let is_bold = false;
      let is_italic = false;
      let is_oblique = false;
      let is_superscript = false;
      let is_subscript = false;

      // newline character only -> don't attempt to add style (will break compilation in LaTeX)
      const spanstyle = sp_te_style_at_position(textobj, li);
      if (spanstyle && !(skipNewline && spanstr === '\n')) {
        if (isBold(spanstyle)) {
          is_bold = true;
          os += '\\textbf{';
        }
        if (spanstyle.font_style.computed === SPCSSFontStyle.SP_CSS_FONT_STYLE_ITALIC) {
          is_italic = true;
          os += '\\textit{';
        }
        if (spanstyle.font_style.computed === SPCSSFontStyle.SP_CSS_FONT_STYLE_OBLIQUE) {
          is_oblique = true;
          os += '\\textsl{'; // this is an accurate choice if the LaTeX chosen font matches the font in Inkscape. Gives bad results when it is not so...
        }
        if (spanstyle.baseline_shift.computed > 0) {
          // superscript
          is_superscript = true;
          os += '\\textsuperscript{';
        }
        if (spanstyle.baseline_shift.computed < 0) {
          is_subscript = true;
          os += '\\textsubscript{';
        }
      }

      os += joinLines(spanstr);

      if (is_subscript) os += '}'; // subscript end
      if (is_superscript) os += '}'; // superscript end
      if (is_oblique) os += '}'; // oblique end
      if (is_italic) os += '}'; // italic end
      if (is_bold) os += '}'; // bold end
    }
    return os;
  }

  sp_text_render(textobj: SPText): void {
    // Nothing to do here... (so don't emit an empty box)
    // Also avoids falling out of sync with the CairoRenderer (which won't render anything in this case either)
    if (!textobj.layout.outputExists()) return;

    // Only PDFLaTeX supports importing a single page of a graphics file,
    // so only PDF backend gets interleaved text/graphics
    if (this._pdflatex && this._omittext_state === OmitTextPageState.GRAPHIC_ON_TOP) {
      this._omittext_state = OmitTextPageState.NEW_PAGE_ON_GRAPHIC;
    }

    const style = textobj.style;

    // get position and alignment
    // Align vertically on the baseline of the font (retrieved from the anchor point)
    // Align horizontally on anchorpoint
    let alignment: string;
    let aligntabular: string;
    switch (style.text_anchor.computed) {
      case SPTextAnchor.SP_CSS_TEXT_ANCHOR_START:
        alignment = '[lt]';
        aligntabular = '{l}';
        break;
      case SPTextAnchor.SP_CSS_TEXT_ANCHOR_END:
        alignment = '[rt]';
        aligntabular = '{r}';
        break;
      default:
        alignment = '[t]';
        aligntabular = '{c}';
        break;
    }

    let anchor: Point | null = null;
    const baseline_anchor_point = textobj.layout.baselineAnchorPoint();
    if (baseline_anchor_point) {
      anchor = baseline_anchor_point.transformed(this.transform());
    } else {
      console.warn(
        'LaTeXTextRenderer::sp_text_render: baselineAnchorPoint unset, text position will be wrong. Please report the issue.',
      );
    }

    let color = new Color(SpaceType.RGB, [0, 0, 0, 1]); // default to full opacity black
    if (style.fill.set && style.fill.isColor()) {
      color = style.fill.getColor().clone();
      color.addOpacity(style.fill_opacity.as_double());
    } else if (style.stroke.set && style.stroke.isColor()) {
      color = style.stroke.getColor().clone();
      color.addOpacity(style.stroke_opacity.as_double());
    }
    color.addOpacity(style.opacity.as_double());

    // get rotation
    const degrees = rotationDegrees(textobj);
    const has_rotation = Math.abs(degrees) > 1e-6;

    // get line-height
    const line_height =
      style.line_height.unit === SPCSSUnit.SP_CSS_UNIT_NONE
        ? style.line_height.computed // unitless 'line-height' (use as-is, computed value is relative value)
        : style.line_height.computed / style.font_size.computed; // with unit (make relative)

    // write to LaTeX
    let os = `    \\put(${num(anchor?.x ?? 0)},${num(anchor?.y ?? 0)}){`;
    const rgb = color.converted(SpaceType.RGB) ?? color;
    os += `\\color[rgb]{${num(rgb.get(0))},${num(rgb.get(1))},${num(rgb.get(2))}}`;
    if (this._pdflatex && rgb.getOpacity() < 1.0) os += `\\transparent{${num(rgb.getOpacity())}}`;
    if (has_rotation) os += `\\rotatebox{${num(degrees)}}{`;
    os += `\\makebox(0,0)${alignment}{`;
    if (line_height !== 1) os += `\\lineheight{${num(line_height)}}`;
    os += '\\smash{';
    os += `\\begin{tabular}[t]${aligntabular}`;

    // Walk through all spans in the text object.
    // Write span strings to LaTeX, associated with font weight and style.
    // replace carriage return with double slash (only the first line break of a span)
    os += this.#spans(
      textobj,
      (s) => {
        const i = s.indexOf('\n');
        return i < 0 ? s : `${s.slice(0, i)}\\\\`;
      },
      true,
    );

    os += '\\end{tabular}'; // tabular end
    os += '}'; // smash end
    if (has_rotation) os += '}'; // rotatebox end
    os += '}'; //makebox end
    os += '}%\n'; // put end

    this._stream += os;
  }

  sp_flowtext_render(flowtext: SPFlowtext): void {
    /*
    Flowtext is possible by using a minipage! :)
    Flowing in rectangle is possible, not in arb shape.
    */

    // Only PDFLaTeX supports importing a single page of a graphics file,
    // so only PDF backend gets interleaved text/graphics
    if (this._pdflatex && this._omittext_state === OmitTextPageState.GRAPHIC_ON_TOP) {
      this._omittext_state = OmitTextPageState.NEW_PAGE_ON_GRAPHIC;
    }

    const style = flowtext.style;

    const frame = flowtext.get_frame(null);
    if (!(frame instanceof SPRect)) {
      console.warn('LaTeX export: non-rectangular flowed text shapes are not supported, skipping text.');
      return; // don't know how to handle non-rect frames yet. is quite uncommon for latex users i think
    }

    // We will transform the coordinates
    const framebox = frame.getRect();

    // get position and alignment
    // Align on topleft corner.
    const alignment = '[lt]';
    let justification = '';
    switch (flowtext.layout.paragraphAlignment(flowtext.layout.begin())) {
      case Alignment.LEFT:
        justification = '\\raggedright ';
        break;
      case Alignment.RIGHT:
        justification = '\\raggedleft ';
        break;
      case Alignment.CENTER:
        justification = '\\centering ';
        break;
      default:
        // no need to add LaTeX code for standard justified output :)
        break;
    }

    // The topleft Corner was calculated after rotating the text which results in a wrong Coordinate.
    // Now, the topleft Corner is rotated after calculating it
    const pos = framebox.corner(0).transformed(this.transform()); //topleft corner

    // determine color and transparency (for now, use rgb color model as it is most native to Inkscape)
    let has_color = false; // if the item has no color set, don't force black color
    let rgb: Color | null = null;
    let opacity = style.opacity.as_double();
    if (style.fill.set && style.fill.isColor()) {
      has_color = true;
      rgb = style.fill.getColor();
      opacity *= style.fill_opacity.as_double();
    } else if (style.stroke.set && style.stroke.isColor()) {
      has_color = true;
      rgb = style.stroke.getColor();
      opacity *= style.stroke_opacity.as_double();
    }
    const has_transparency = opacity < 1.0;

    // get rotation
    const degrees = rotationDegrees(flowtext);
    const has_rotation = Math.abs(degrees) > 1e-6;

    // write to LaTeX
    let os = `    \\put(${num(pos.x)},${num(pos.y)}){`;
    if (has_color && rgb) {
      // SP_RGBA32_*_F of the 8-bit channels
      const v = rgb.toRGBA();
      const f = (shift: number) => num(((v >>> shift) & 0xff) / 255);
      os += `\\color[rgb]{${f(24)},${f(16)},${f(8)}}`;
    }
    if (this._pdflatex && has_transparency) os += `\\transparent{${num(opacity)}}`;
    if (has_rotation) os += `\\rotatebox{${num(degrees)}}{`;
    os += `\\makebox(0,0)${alignment}{`;

    // Scale the x width correctly
    os += `\\begin{minipage}{${num(framebox.width() * this.transform().expansionX())}\\unitlength}`;
    os += justification;

    // replace carriage return with double slash
    os += this.#spans(flowtext, (s) => s.split('\n').join('\\\\ '), false);

    os += '\\end{minipage}';
    if (has_rotation) os += '}'; // rotatebox end
    os += '}'; //makebox end
    os += '}%\n'; // put end

    this._stream += os;
  }

  sp_root_render(root: SPRoot): void {
    this.push_transform(root.c2p);
    this.sp_group_render(root);
    this.pop_transform();
  }

  sp_item_invoke_render(item: SPItem): void {
    // Check item's visibility
    if (item.isHidden()) return;

    if (item instanceof SPRoot) {
      this.sp_root_render(item);
      return;
    }
    if (item instanceof SPGroup) {
      this.sp_group_render(item);
      return;
    }
    if (item instanceof SPUse) {
      this.sp_use_render(item);
      return;
    }
    if (item instanceof SPText) {
      this.sp_text_render(item);
      return;
    }
    if (item instanceof SPFlowtext) {
      this.sp_flowtext_render(item);
      return;
    }
    // Only PDFLaTeX supports importing a single page of a graphics file,
    // so only PDF backend gets interleaved text/graphics
    if (
      this._pdflatex &&
      (this._omittext_state === OmitTextPageState.EMPTY ||
        this._omittext_state === OmitTextPageState.NEW_PAGE_ON_GRAPHIC)
    ) {
      this.writeGraphicPage();
    }
    this._omittext_state = OmitTextPageState.GRAPHIC_ON_TOP;
  }

  renderItem(item: SPItem): void {
    this.push_transform(item.transform);
    this.sp_item_invoke_render(item);
    this.pop_transform();
  }

  writeGraphicPage(): void {
    // strip pathname, as it is probably desired. Having a specific path in the TeX file is not convenient.
    if (this._pdflatex) {
      this._stream += `    \\put(0,0){\\includegraphics[width=\\unitlength,page=${this._omittext_page++}]{${this._filename}}}%\n`;
    } else {
      this._stream += `    \\put(0,0){\\includegraphics[width=\\unitlength]{${this._filename}}}%\n`;
    }
  }

  setupDocument(doc: SPDocument, _base: SPItem | null = null): boolean {
    const d = doc.getDimensions();

    // scale all coordinates, such that the width of the image is 1, this is convenient for scaling the image in LaTeX
    const scale = 1 / d.x;
    const _width = d.x * scale;
    const _height = d.y * scale;
    // corner(3) of the rect (0, 0)-(w, h) is (0, h)
    this.push_transform(Translate(0, -d.y).multiply(Scale(scale, -scale)));

    // write the info to LaTeX
    let os = '';
    // scaling of the image when including it in LaTeX
    os += '  \\ifx\\svgwidth\\undefined%\n';
    os += `    \\setlength{\\unitlength}{${num(convertUnit(d.x, 'px', 'pt'))}bp}%\n`; // note: 'bp' is the Postscript pt unit in LaTeX, see LP bug #792384
    os += '    \\ifx\\svgscale\\undefined%\n';
    os += '      \\relax%\n';
    os += '    \\else%\n';
    os += '      \\setlength{\\unitlength}{\\unitlength * \\real{\\svgscale}}%\n';
    os += '    \\fi%\n';
    os += '  \\else%\n';
    os += '    \\setlength{\\unitlength}{\\svgwidth}%\n';
    os += '  \\fi%\n';
    os += '  \\global\\let\\svgwidth\\undefined%\n';
    os += '  \\global\\let\\svgscale\\undefined%\n';
    os += '  \\makeatother%\n';

    os += `  \\begin{picture}(${num(_width)},${num(_height)})%\n`;

    // set \baselineskip equal to fontsize (the closest we can seem to get to CSS "line-height: 1;")
    // and remove column spacing from tabular
    os += '    \\lineheight{1}%\n';
    os += '    \\setlength\\tabcolsep{0pt}%\n';

    this._stream += os;

    if (!this._pdflatex) this.writeGraphicPage();

    return true;
  }

  transform(): Affine {
    return this._transform_stack[this._transform_stack.length - 1]!;
  }

  push_transform(tr: Affine): void {
    const top = this._transform_stack[this._transform_stack.length - 1];
    this._transform_stack.push(top ? tr.multiply(top) : tr);
  }

  pop_transform(): void {
    this._transform_stack.pop();
  }
}

/**
 * Render the text of the document into a LaTeX file for the image file filename (upstream
 * latex_render_document_text_to_file writes "<filename>_tex"); the file text, or null.
 * pdflatex: the PDF (one page per graphic layer) instead of PS/EPS.
 */
export function latex_render_document_text_to_file(
  doc: SPDocument,
  filename: string,
  pdflatex: boolean,
): string | null {
  doc.ensureUpToDate();

  const root = doc.getRoot();
  if (!root) return null;

  const renderer = new LaTeXTextRenderer(pdflatex);
  if (renderer.setTargetFile(filename) && renderer.setupDocument(doc, root)) {
    renderer.renderItem(root);
    return renderer.finish();
  }
  return null;
}
