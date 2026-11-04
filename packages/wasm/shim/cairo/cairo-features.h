/* SPDX-License-Identifier: GPL-2.0-or-later */
/* cairo-features.h of cairo for the Emscripten build of cairo-module (build.sh): the image,
 * PDF, PostScript and SVG surfaces, PNG functions and FreeType fonts (without fontconfig). */
#ifndef CAIRO_FEATURES_H
#define CAIRO_FEATURES_H
#define CAIRO_HAS_IMAGE_SURFACE 1
#define CAIRO_HAS_PDF_SURFACE 1
#define CAIRO_HAS_PS_SURFACE 1
#define CAIRO_HAS_SVG_SURFACE 1
#define CAIRO_HAS_PNG_FUNCTIONS 1
#define CAIRO_HAS_FT_FONT 1
#define CAIRO_HAS_USER_FONT 1
#define CAIRO_HAS_MIME_SURFACE 1
#define CAIRO_HAS_RECORDING_SURFACE 1
#define CAIRO_HAS_OBSERVER_SURFACE 1
#endif
