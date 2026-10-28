// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-string.cpp, src/object/sp-string.h
/*
 * SVG <text> and <tspan> implementation
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import type { SPDocument } from '../document.ts';
import { SPWhiteSpace } from '../style-enums.ts';
import type { Node } from '../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SPObject, SPXMLSpace } from './sp-object.ts';

/**
 * A text node in text content (upstream SPString). string is the content
 * with the white space handled per 'white-space' and 'xml:space' of the
 * parent.
 */
export class SPString extends SPObject {
  string = '';

  protected override build(document: SPDocument, repr: Node): void {
    this.readContent();
    super.build(document, repr);
  }

  protected override readContent(): void {
    let string = '';
    const xml_string = this.getRepr().content() ?? '';

    // SVG2/CSS Text Level 3 'white-space' has five values.
    // See: http://dev.w3.org/csswg/css-text/#white-space
    //            |  New Lines |  Spaces/Tabs | Text Wrapping
    //   ---------|------------|--------------|--------------
    //   normal   |  Collapse  |   Collapse   |     Wrap
    //   pre      |  Preserve  |   Preserve   |   No Wrap
    //   nowrap   |  Collapse  |   Collapse   |   No Wrap
    //   pre-wrap |  Preserve  |   Preserve   |     Wrap
    //   pre-line |  Preserve  |   Collapse   |     Wrap

    // 'xml:space' has two values:
    //   'default' which corresponds to 'normal' (without wrapping).
    //   'preserve' which corresponds to 'pre' except new lines are converted to spaces.
    //  See algorithms described in svg 1.1 section 10.15

    let collapse_space = true;
    let collapse_line = true;
    let is_css = false;

    // Strings don't have style, check parent for style
    const ws = this.parent?.style.white_space.computed;
    if (ws !== undefined) {
      if (
        ws === SPWhiteSpace.SP_CSS_WHITE_SPACE_PRE ||
        ws === SPWhiteSpace.SP_CSS_WHITE_SPACE_PREWRAP ||
        ws === SPWhiteSpace.SP_CSS_WHITE_SPACE_PRELINE
      ) {
        collapse_line = false;
      }
      if (ws === SPWhiteSpace.SP_CSS_WHITE_SPACE_PRE || ws === SPWhiteSpace.SP_CSS_WHITE_SPACE_PREWRAP) {
        collapse_space = false;
      }
      if (ws !== SPWhiteSpace.SP_CSS_WHITE_SPACE_NORMAL) {
        is_css = true; // If white-space not normal, we assume white-space is set.
      }
    }
    if (!is_css) {
      // SVG 2: Use 'xml:space' only if 'white-space' not 'normal'.
      // Strings have no xml:space attribute; it is inherited from the parent.
      if (this.parent?.xmlSpace.value === SPXMLSpace.PRESERVE) collapse_space = false;
    }

    let white_space = false;
    for (const c of xml_string) {
      switch (c) {
        case '\r':
          // XML Parsers convert 0xa, 0xd, 0xD 0xA to 0xA. CSS also follows this rule so we
          // should never see 0xd.
          continue;
        case '\n':
          if (collapse_line) {
            if (!is_css && collapse_space) continue; // xml:space == 'default' strips LFs.
            white_space = true; // Convert to space and collapse
          } else {
            string += c; // Preserve line feed
          }
          continue;
        case '\t':
        case ' ':
          if (collapse_space)
            white_space = true; // Collapse white space
          else string += c; // Preserve
          continue;
        default:
          if (white_space && (string.length || this.getPrev() !== null)) string += ' ';
          string += c;
          white_space = false;
      }
    }

    // Insert white space at end if more text follows
    // (can't use SPObject.getNext() when the SPObject tree is still being built)
    if (white_space && this.getRepr().next() !== null) string += ' ';

    this.string = string;
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}
