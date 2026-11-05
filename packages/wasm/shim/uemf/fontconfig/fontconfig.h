/* SPDX-License-Identifier: GPL-2.0-or-later */
/* The fontconfig API that text_reassemble.c (the text of the EMF and WMF import) uses.
 * There is no fontconfig in WASM: the fonts are the files that the app adds with
 * FcShimAddFont() (shim/uemf/fontconfig.cpp). Only the metrics of the fonts are used;
 * the SVG text keeps the font names of the metafile.
 */
#ifndef SHIM_FONTCONFIG_H
#define SHIM_FONTCONFIG_H

#ifdef __cplusplus
extern "C" {
#endif

typedef unsigned char FcChar8;
typedef unsigned int FcChar32;
typedef int FcBool;
#define FcFalse 0
#define FcTrue 1

typedef enum _FcResult {
    FcResultMatch,
    FcResultNoMatch,
    FcResultTypeMismatch,
    FcResultNoId,
    FcResultOutOfMemory
} FcResult;

typedef enum _FcMatchKind { FcMatchPattern, FcMatchFont, FcMatchScan } FcMatchKind;

typedef struct _FcPattern FcPattern;
typedef struct _FcCharSet FcCharSet;
typedef struct _FcConfig FcConfig;

typedef struct _FcFontSet {
    int nfont;
    int sfont;
    FcPattern **fonts;
} FcFontSet;

#define FC_FAMILY "family"
#define FC_STYLE "style"
#define FC_SLANT "slant"
#define FC_WEIGHT "weight"
#define FC_SIZE "size"
#define FC_WIDTH "width"
#define FC_FILE "file"
#define FC_FULLNAME "fullname"
#define FC_CHARSET "charset"
#define FC_OUTLINE "outline"
#define FC_SCALABLE "scalable"
#define FC_DPI "dpi"
#define FC_FONTVERSION "fontversion"
#define FC_FOUNDRY "foundry"
#define FC_FAMILYLANG "familylang"
#define FC_STYLELANG "stylelang"
#define FC_FULLNAMELANG "fullnamelang"
#define FC_CAPABILITY "capability"
#define FC_FONTFORMAT "fontformat"

#define FC_WEIGHT_THIN 0
#define FC_WEIGHT_EXTRALIGHT 40
#define FC_WEIGHT_LIGHT 50
#define FC_WEIGHT_NORMAL 80
#define FC_WEIGHT_REGULAR 80
#define FC_WEIGHT_MEDIUM 100
#define FC_WEIGHT_SEMIBOLD 180
#define FC_WEIGHT_BOLD 200
#define FC_WEIGHT_EXTRABOLD 205
#define FC_WEIGHT_HEAVY 210
#define FC_SLANT_ROMAN 0
#define FC_SLANT_ITALIC 100
#define FC_SLANT_OBLIQUE 110
#define FC_WIDTH_NORMAL 100

FcBool FcInit(void);
void FcFini(void);
FcPattern *FcNameParse(const FcChar8 *name);
FcBool FcConfigSubstitute(FcConfig *config, FcPattern *p, FcMatchKind kind);
void FcDefaultSubstitute(FcPattern *pattern);
FcFontSet *FcFontSort(FcConfig *config, FcPattern *p, FcBool trim, FcCharSet **csp, FcResult *result);
FcPattern *FcFontRenderPrepare(FcConfig *config, FcPattern *pat, FcPattern *font);
FcResult FcPatternGetString(const FcPattern *p, const char *object, int n, FcChar8 **s);
FcResult FcPatternGetDouble(const FcPattern *p, const char *object, int n, double *d);
FcResult FcPatternGetInteger(const FcPattern *p, const char *object, int n, int *i);
FcResult FcPatternGetBool(const FcPattern *p, const char *object, int n, FcBool *b);
FcResult FcPatternGetCharSet(const FcPattern *p, const char *object, int n, FcCharSet **c);
FcBool FcCharSetHasChar(const FcCharSet *fcs, FcChar32 ucs4);
void FcPatternDestroy(FcPattern *p);
void FcFontSetDestroy(FcFontSet *s);

/** Not fontconfig: add a font file (in the Emscripten file system) to the font list.
 *  weight and slant are fontconfig values (FC_WEIGHT_REGULAR 80, FC_SLANT_ITALIC 100). */
void FcShimAddFont(const char *file, const char *family, const char *style, int weight, int slant);
/** Not fontconfig: the families asked for since the last call, one per line. */
const char *FcShimRequestedFamilies(void);

#ifdef __cplusplus
}
#endif

#endif
