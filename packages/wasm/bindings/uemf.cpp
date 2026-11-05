// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/emf-inout.cpp, src/extension/internal/wmf-inout.cpp, src/extension/internal/metafile-inout.cpp, src/extension/internal/text_reassemble.c, src/3rdparty/libuemf/, src/util-string/symbol-convert.c
// Embind API of uemf-module.wasm.
//
// Import: the upstream Emf::open() and Wmf::open() run unchanged (see shim/uemf). They read
// the file from the Emscripten file system and return the SVG text of the drawing. The text
// of the import measures its fonts with FreeType; the app adds the font files with addFont().
//
// Export: the EMF functions of libuemf that emf-print.cpp uses, with the same names, for the
// TypeScript PrintEmf (packages/editor/src/extension/internal/emf-print.ts). The WMF functions
// are in uwmf.cpp. Structs go by value as JavaScript objects; records, EMFTRACK, EMFHANDLES
// and other buffers stay in the WASM memory and go to JavaScript as pointers (numbers).
// Functions with output parameters return an object with the outputs.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "document.h"
#include "extension/internal/emf-inout.h"
#include "extension/internal/wmf-inout.h"
#include "fontconfig/fontconfig.h"
#include "util-string/symbol-convert.h"

using emscripten::val;
using Inkscape::Extension::Implementation::Implementation;

namespace {

// ---- Import ----

/** Write the metafile to a file, open it with the implementation and return the SVG text ("" on error). */
std::string import_metafile(Implementation &impl, std::string const &data, char const *path)
{
    FILE *fp = std::fopen(path, "wb");
    if (!fp) {
        return "";
    }
    std::fwrite(data.data(), 1, data.size(), fp);
    std::fclose(fp);
    auto doc = impl.open(nullptr, path, false);
    std::remove(path);
    return doc ? doc->svg : "";
}

std::string emf_import(std::string const &data)
{
    Inkscape::Extension::Internal::Emf emf;
    return import_metafile(emf, data, "/tmp/import.emf");
}

std::string wmf_import(std::string const &data)
{
    Inkscape::Extension::Internal::Wmf wmf;
    return import_metafile(wmf, data, "/tmp/import.wmf");
}

/** Add a font for the text of the import (weight and slant are fontconfig values). */
void add_font(std::string const &name, std::string const &data, std::string const &family, std::string const &style,
              int weight, int slant)
{
    mkdir("/tmp/fonts", 0777);
    std::string path = "/tmp/fonts/" + name;
    FILE *fp = std::fopen(path.c_str(), "wb");
    if (!fp) {
        return;
    }
    std::fwrite(data.data(), 1, data.size(), fp);
    std::fclose(fp);
    FcShimAddFont(path.c_str(), family.c_str(), style.c_str(), weight, slant);
}

// ---- Memory and files ----

template <typename T>
uintptr_t ptr(T *p)
{
    return reinterpret_cast<uintptr_t>(p);
}

template <typename T>
T *to(uintptr_t p)
{
    return reinterpret_cast<T *>(p);
}

/** Copy bytes into a new malloc() buffer. */
uintptr_t copy_in(std::string const &bytes)
{
    char *p = static_cast<char *>(std::malloc(bytes.size() ? bytes.size() : 1));
    std::memcpy(p, bytes.data(), bytes.size());
    return ptr(p);
}

/** The file (written by emf_finish or wmf_finish) as a Uint8Array; the file is removed. */
val read_file(std::string const &path)
{
    FILE *fp = std::fopen(path.c_str(), "rb");
    if (!fp) {
        return val::null();
    }
    std::vector<unsigned char> data;
    unsigned char buf[65536];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof(buf), fp)) > 0) {
        data.insert(data.end(), buf, buf + n);
    }
    std::fclose(fp);
    std::remove(path.c_str());
    return val::global("Uint8Array").new_(val(emscripten::typed_memory_view(data.size(), data.data())));
}

template <typename T>
std::vector<T> vec(val const &array)
{
    return emscripten::vecFromJSArray<T>(array);
}

// ---- EMF file ----

val emf_start_(std::string const &name, uint32_t initsize, uint32_t chunksize)
{
    EMFTRACK *et = nullptr;
    int status = emf_start(name.c_str(), initsize, chunksize, &et);
    val out = val::object();
    out.set("status", status);
    out.set("et", ptr(et));
    return out;
}

int emf_finish_(uintptr_t et, uintptr_t eht)
{
    return emf_finish(to<EMFTRACK>(et), to<EMFHANDLES>(eht));
}

int emf_free_(uintptr_t et)
{
    auto p = to<EMFTRACK>(et);
    return emf_free(&p);
}

int emf_append_(uintptr_t rec, uintptr_t et, int freerec)
{
    return emf_append(to<U_ENHMETARECORD>(rec), to<EMFTRACK>(et), freerec);
}

uintptr_t htable_create_(uint32_t initsize, uint32_t chunksize)
{
    EMFHANDLES *eht = nullptr;
    htable_create(initsize, chunksize, &eht);
    return ptr(eht);
}

int htable_free_(uintptr_t eht)
{
    auto p = to<EMFHANDLES>(eht);
    return htable_free(&p);
}

val drawing_size_100th_(int x100thmm, int y100thmm, float dpmm)
{
    U_RECTL rclBounds, rclFrame;
    drawing_size_100th(x100thmm, y100thmm, dpmm, &rclBounds, &rclFrame);
    val out = val::object();
    out.set("rclBounds", rclBounds);
    out.set("rclFrame", rclFrame);
    return out;
}

val device_size_(int xmm, int ymm, float dpmm)
{
    U_SIZEL szlDev, szlMm;
    device_size(xmm, ymm, dpmm, &szlDev, &szlMm);
    val out = val::object();
    out.set("szlDev", szlDev);
    out.set("szlMm", szlMm);
    return out;
}

// ---- Text ----

/** U_Utf8ToUtf16le(src, 0, nullptr): a malloc() buffer, 0 on error. */
uintptr_t U_Utf8ToUtf16le_(std::string const &src)
{
    return ptr(U_Utf8ToUtf16le(src.c_str(), 0, nullptr));
}

uint32_t wchar16len_(uintptr_t src)
{
    return wchar16len(to<uint16_t>(src));
}

int U_Utf16leEdit_(uintptr_t src, uint16_t find, uint16_t replace)
{
    return U_Utf16leEdit(to<uint16_t>(src), find, replace);
}

val UnicodeToNon_(uintptr_t text)
{
    int ccount = 0;
    int newfont = 0;
    UnicodeToNon(to<uint16_t>(text), &ccount, &newfont);
    val out = val::object();
    out.set("ccount", ccount);
    out.set("newfont", newfont);
    return out;
}

std::string FontName_(int code)
{
    char *name = FontName(code);
    return name ? name : "";
}

// ---- Objects and records ----

uintptr_t textcomment_set_(std::string const &string)
{
    return ptr(textcomment_set(string.c_str()));
}

uintptr_t selectobject_set_(uint32_t ihObject, uintptr_t eht)
{
    return ptr(selectobject_set(ihObject, to<EMFHANDLES>(eht)));
}

uintptr_t deleteobject_set_(uint32_t ihObject, uintptr_t eht)
{
    return ptr(deleteobject_set(&ihObject, to<EMFHANDLES>(eht)));
}

val handle_record(char *rec, uint32_t ih)
{
    val out = val::object();
    out.set("rec", ptr(rec));
    out.set("ih", ih);
    return out;
}

val createbrushindirect_set_(uintptr_t eht, U_LOGBRUSH lb)
{
    uint32_t ih = 0;
    char *rec = createbrushindirect_set(&ih, to<EMFHANDLES>(eht), lb);
    return handle_record(rec, ih);
}

val createdibpatternbrushpt_set_(uintptr_t eht, uint32_t iUsage, uintptr_t Bmi, uint32_t cbPx, uintptr_t Px)
{
    uint32_t ih = 0;
    char *rec = createdibpatternbrushpt_set(&ih, to<EMFHANDLES>(eht), iUsage, to<U_BITMAPINFO>(Bmi), cbPx,
                                            to<char const>(Px));
    return handle_record(rec, ih);
}

uintptr_t extlogpen_set_(uint32_t elpPenStyle, uint32_t elpWidth, uint32_t elpBrushStyle, U_COLORREF elpColor,
                         int32_t elpHatch, val const &dashes)
{
    auto dash = vec<uint32_t>(dashes);
    return ptr(extlogpen_set(elpPenStyle, elpWidth, elpBrushStyle, elpColor, elpHatch, dash.size(),
                             dash.empty() ? nullptr : dash.data()));
}

val extcreatepen_set_(uintptr_t eht, uintptr_t Bmi, uint32_t cbPx, uintptr_t Px, uintptr_t elp)
{
    uint32_t ih = 0;
    char *rec = extcreatepen_set(&ih, to<EMFHANDLES>(eht), to<U_BITMAPINFO>(Bmi), cbPx, to<char>(Px),
                                 to<U_EXTLOGPEN>(elp));
    return handle_record(rec, ih);
}

/** logfont_set() into a malloc() buffer (U_LOGFONT has an array member). */
uintptr_t logfont_set_(int32_t lfHeight, int32_t lfWidth, int32_t lfEscapement, int32_t lfOrientation,
                       int32_t lfWeight, uint8_t lfItalic, uint8_t lfUnderline, uint8_t lfStrikeOut, uint8_t lfCharSet,
                       uint8_t lfOutPrecision, uint8_t lfClipPrecision, uint8_t lfQuality, uint8_t lfPitchAndFamily,
                       uintptr_t lfFaceName)
{
    auto lf = static_cast<U_LOGFONT *>(std::malloc(sizeof(U_LOGFONT)));
    *lf = logfont_set(lfHeight, lfWidth, lfEscapement, lfOrientation, lfWeight, lfItalic, lfUnderline, lfStrikeOut,
                      lfCharSet, lfOutPrecision, lfClipPrecision, lfQuality, lfPitchAndFamily,
                      to<uint16_t>(lfFaceName));
    return ptr(lf);
}

val extcreatefontindirectw_set_(uintptr_t eht, uintptr_t elf, uintptr_t elfw)
{
    uint32_t ih = 0;
    char *rec = extcreatefontindirectw_set(&ih, to<EMFHANDLES>(eht), to<char const>(elf), to<char const>(elfw));
    return handle_record(rec, ih);
}

/** RGBA_to_DIB with the RGBA pixels from JavaScript; px and ct are malloc() buffers. */
val RGBA_to_DIB_(std::string const &rgba_px, int w, int h, int stride, uint32_t colortype, int use_ct, int invert)
{
    char *px = nullptr;
    uint32_t cbPx = 0;
    PU_RGBQUAD ct = nullptr;
    int numCt = 0;
    int status = RGBA_to_DIB(&px, &cbPx, &ct, &numCt, rgba_px.data(), w, h, stride, colortype, use_ct, invert);
    val out = val::object();
    out.set("status", status);
    out.set("px", ptr(px));
    out.set("cbPx", cbPx);
    out.set("ct", ptr(ct));
    out.set("numCt", numCt);
    return out;
}

/** Swap the R and B bytes of 4 byte pixels in the WASM memory (PrintMetafile::swapRBinRGBA). */
void swapRBinRGBA_(uintptr_t px, int pixels)
{
    auto p = to<char>(px);
    for (int i = 0; i < pixels * 4; p += 4, i += 4) {
        std::swap(p[0], p[2]);
    }
}

uintptr_t bitmapinfo_set_(U_BITMAPINFOHEADER BmiHeader, uintptr_t BmiColors)
{
    return ptr(bitmapinfo_set(BmiHeader, to<U_RGBQUAD>(BmiColors)));
}

uintptr_t emrtext_set_(U_POINTL ptlReference, uint32_t NumString, uint32_t cbChar, uintptr_t String,
                       uint32_t fOptions, U_RECTL rcl, val const &Dx)
{
    auto dx = vec<uint32_t>(Dx);
    return ptr(emrtext_set(ptlReference, NumString, cbChar, to<void>(String), fOptions, rcl,
                           dx.empty() ? nullptr : dx.data()));
}

uintptr_t U_EMRHEADER_set_(U_RECTL rclBounds, U_RECTL rclFrame, uint32_t nDesc, uintptr_t Description,
                           U_SIZEL szlDevice, U_SIZEL szlMillimeters, uint32_t bOpenGL)
{
    return ptr(U_EMRHEADER_set(rclBounds, rclFrame, nullptr, nDesc, to<uint16_t>(Description), szlDevice,
                               szlMillimeters, bOpenGL));
}

std::vector<U_POINTL> points(val const &pts)
{
    return vec<U_POINTL>(pts);
}

uintptr_t U_EMRPOLYGON_set_(U_RECTL rclBounds, val const &pts)
{
    auto p = points(pts);
    return ptr(U_EMRPOLYGON_set(rclBounds, p.size(), p.data()));
}

uintptr_t U_EMRPOLYBEZIERTO_set_(U_RECTL rclBounds, val const &pts)
{
    auto p = points(pts);
    return ptr(U_EMRPOLYBEZIERTO_set(rclBounds, p.size(), p.data()));
}

uintptr_t U_EMREOF_set_(uintptr_t et)
{
    return ptr(U_EMREOF_set(0, nullptr, to<EMFTRACK>(et)));
}

uintptr_t U_EMRGRADIENTFILL_set_(U_RECTL rclBounds, val const &TriVert, uint32_t ulMode, val const &GradObj)
{
    auto tv = vec<U_TRIVERTEX>(TriVert);
    auto go = vec<uint32_t>(GradObj);
    uint32_t nGradObj = ulMode == U_GRADIENT_FILL_TRIANGLE ? go.size() / 3 : go.size() / 2;
    return ptr(U_EMRGRADIENTFILL_set(rclBounds, tv.size(), nGradObj, ulMode, tv.data(), go.data()));
}

uintptr_t U_EMRSTRETCHDIBITS_set_(U_RECTL rclBounds, U_POINTL Dest, U_POINTL cDest, U_POINTL Src, U_POINTL cSrc,
                                  uint32_t iUsageSrc, uint32_t dwRop, uintptr_t Bmi, uint32_t cbPx, uintptr_t Px)
{
    return ptr(U_EMRSTRETCHDIBITS_set(rclBounds, Dest, cDest, Src, cSrc, iUsageSrc, dwRop, to<U_BITMAPINFO>(Bmi),
                                      cbPx, to<char>(Px)));
}

uintptr_t U_EMREXTTEXTOUTW_set_(U_RECTL rclBounds, uint32_t iGraphicsMode, float exScale, float eyScale,
                                uintptr_t emrtext)
{
    return ptr(U_EMREXTTEXTOUTW_set(rclBounds, iGraphicsMode, exScale, eyScale, to<U_EMRTEXT>(emrtext)));
}

// Records with only scalar or struct arguments.
#define REC0(name)                                                                                                     \
    uintptr_t name##_()                                                                                                \
    {                                                                                                                  \
        return ptr(name());                                                                                            \
    }
#define REC1(name, T)                                                                                                  \
    uintptr_t name##_(T a)                                                                                             \
    {                                                                                                                  \
        return ptr(name(a));                                                                                           \
    }
REC1(U_EMRSETMAPMODE_set, uint32_t)
REC1(U_EMRSETBKMODE_set, uint32_t)
REC1(U_EMRSETPOLYFILLMODE_set, uint32_t)
REC1(U_EMRSETTEXTALIGN_set, uint32_t)
REC1(U_EMRSETROP2_set, uint32_t)
REC1(U_EMRSETSTRETCHBLTMODE_set, uint32_t)
REC1(U_EMRSETMITERLIMIT_set, uint32_t)
REC1(U_EMRSELECTCLIPPATH_set, uint32_t)
REC1(U_EMRRESTOREDC_set, int32_t)
REC1(U_EMRSETTEXTCOLOR_set, U_COLORREF)
REC1(U_EMRSETBKCOLOR_set, U_COLORREF)
REC1(U_EMRMOVETOEX_set, U_POINTL)
REC1(U_EMRLINETO_set, U_POINTL)
REC1(U_EMRRECTANGLE_set, U_RECTL)
REC1(U_EMRELLIPSE_set, U_RECTL)
REC1(U_EMRFILLPATH_set, U_RECTL)
REC1(U_EMRSTROKEPATH_set, U_RECTL)
REC1(U_EMRSTROKEANDFILLPATH_set, U_RECTL)
REC0(U_EMRSAVEDC_set)
REC0(U_EMRBEGINPATH_set)
REC0(U_EMRENDPATH_set)
REC0(U_EMRCLOSEFIGURE_set)

uintptr_t U_EMRMODIFYWORLDTRANSFORM_set_(U_XFORM xform, uint32_t iMode)
{
    return ptr(U_EMRMODIFYWORLDTRANSFORM_set(xform, iMode));
}

void free_(uintptr_t p)
{
    std::free(to<void>(p));
}

} // namespace

EMSCRIPTEN_BINDINGS(uemf)
{
    using emscripten::function;
    using emscripten::value_object;

    function("emfImport", &emf_import);
    function("wmfImport", &wmf_import);
    function("addFont", &add_font);

    value_object<U_COLORREF>("U_COLORREF")
        .field("Red", &U_COLORREF::Red)
        .field("Green", &U_COLORREF::Green)
        .field("Blue", &U_COLORREF::Blue)
        .field("Reserved", &U_COLORREF::Reserved);
    value_object<U_POINTL>("U_POINTL").field("x", &U_POINTL::x).field("y", &U_POINTL::y);
    value_object<U_SIZEL>("U_SIZEL").field("cx", &U_SIZEL::cx).field("cy", &U_SIZEL::cy);
    value_object<U_RECTL>("U_RECTL")
        .field("left", &U_RECTL::left)
        .field("top", &U_RECTL::top)
        .field("right", &U_RECTL::right)
        .field("bottom", &U_RECTL::bottom);
    value_object<U_XFORM>("U_XFORM")
        .field("eM11", &U_XFORM::eM11)
        .field("eM12", &U_XFORM::eM12)
        .field("eM21", &U_XFORM::eM21)
        .field("eM22", &U_XFORM::eM22)
        .field("eDx", &U_XFORM::eDx)
        .field("eDy", &U_XFORM::eDy);
    value_object<U_LOGBRUSH>("U_LOGBRUSH")
        .field("lbStyle", &U_LOGBRUSH::lbStyle)
        .field("lbColor", &U_LOGBRUSH::lbColor)
        .field("lbHatch", &U_LOGBRUSH::lbHatch);
    value_object<U_TRIVERTEX>("U_TRIVERTEX")
        .field("x", &U_TRIVERTEX::x)
        .field("y", &U_TRIVERTEX::y)
        .field("Red", &U_TRIVERTEX::Red)
        .field("Green", &U_TRIVERTEX::Green)
        .field("Blue", &U_TRIVERTEX::Blue)
        .field("Alpha", &U_TRIVERTEX::Alpha);
    value_object<U_BITMAPINFOHEADER>("U_BITMAPINFOHEADER")
        .field("biSize", &U_BITMAPINFOHEADER::biSize)
        .field("biWidth", &U_BITMAPINFOHEADER::biWidth)
        .field("biHeight", &U_BITMAPINFOHEADER::biHeight)
        .field("biPlanes", &U_BITMAPINFOHEADER::biPlanes)
        .field("biBitCount", &U_BITMAPINFOHEADER::biBitCount)
        .field("biCompression", &U_BITMAPINFOHEADER::biCompression)
        .field("biSizeImage", &U_BITMAPINFOHEADER::biSizeImage)
        .field("biXPelsPerMeter", &U_BITMAPINFOHEADER::biXPelsPerMeter)
        .field("biYPelsPerMeter", &U_BITMAPINFOHEADER::biYPelsPerMeter)
        .field("biClrUsed", &U_BITMAPINFOHEADER::biClrUsed)
        .field("biClrImportant", &U_BITMAPINFOHEADER::biClrImportant);

    function("copy_in", &copy_in);
    function("read_file", &read_file);
    function("free", &free_);

    function("emf_start", &emf_start_);
    function("emf_finish", &emf_finish_);
    function("emf_free", &emf_free_);
    function("emf_append", &emf_append_);
    function("htable_create", &htable_create_);
    function("htable_free", &htable_free_);
    function("drawing_size_100th", &drawing_size_100th_);
    function("device_size", &device_size_);

    function("U_Utf8ToUtf16le", &U_Utf8ToUtf16le_);
    function("wchar16len", &wchar16len_);
    function("U_Utf16leEdit", &U_Utf16leEdit_);
    function("TableGen", &TableGen);
    function("UnicodeToNon", &UnicodeToNon_);
    function("FontName", &FontName_);
    function("CanUTN", &CanUTN);
    function("SingleUnicodeToNon", &SingleUnicodeToNon);

    function("textcomment_set", &textcomment_set_);
    function("selectobject_set", &selectobject_set_);
    function("deleteobject_set", &deleteobject_set_);
    function("createbrushindirect_set", &createbrushindirect_set_);
    function("createdibpatternbrushpt_set", &createdibpatternbrushpt_set_);
    function("extlogpen_set", &extlogpen_set_);
    function("extcreatepen_set", &extcreatepen_set_);
    function("logfont_set", &logfont_set_);
    function("extcreatefontindirectw_set", &extcreatefontindirectw_set_);
    function("RGBA_to_DIB", &RGBA_to_DIB_);
    function("swapRBinRGBA", &swapRBinRGBA_);
    function("bitmapinfoheader_set", &bitmapinfoheader_set);
    function("bitmapinfo_set", &bitmapinfo_set_);
    function("emrtext_set", &emrtext_set_);

    function("U_EMRHEADER_set", &U_EMRHEADER_set_);
    function("U_EMRPOLYGON_set", &U_EMRPOLYGON_set_);
    function("U_EMRPOLYBEZIERTO_set", &U_EMRPOLYBEZIERTO_set_);
    function("U_EMREOF_set", &U_EMREOF_set_);
    function("U_EMRGRADIENTFILL_set", &U_EMRGRADIENTFILL_set_);
    function("U_EMRSTRETCHDIBITS_set", &U_EMRSTRETCHDIBITS_set_);
    function("U_EMREXTTEXTOUTW_set", &U_EMREXTTEXTOUTW_set_);
    function("U_EMRMODIFYWORLDTRANSFORM_set", &U_EMRMODIFYWORLDTRANSFORM_set_);
    function("U_EMRSETMAPMODE_set", &U_EMRSETMAPMODE_set_);
    function("U_EMRSETBKMODE_set", &U_EMRSETBKMODE_set_);
    function("U_EMRSETPOLYFILLMODE_set", &U_EMRSETPOLYFILLMODE_set_);
    function("U_EMRSETTEXTALIGN_set", &U_EMRSETTEXTALIGN_set_);
    function("U_EMRSETROP2_set", &U_EMRSETROP2_set_);
    function("U_EMRSETSTRETCHBLTMODE_set", &U_EMRSETSTRETCHBLTMODE_set_);
    function("U_EMRSETMITERLIMIT_set", &U_EMRSETMITERLIMIT_set_);
    function("U_EMRSELECTCLIPPATH_set", &U_EMRSELECTCLIPPATH_set_);
    function("U_EMRRESTOREDC_set", &U_EMRRESTOREDC_set_);
    function("U_EMRSETTEXTCOLOR_set", &U_EMRSETTEXTCOLOR_set_);
    function("U_EMRSETBKCOLOR_set", &U_EMRSETBKCOLOR_set_);
    function("U_EMRMOVETOEX_set", &U_EMRMOVETOEX_set_);
    function("U_EMRLINETO_set", &U_EMRLINETO_set_);
    function("U_EMRRECTANGLE_set", &U_EMRRECTANGLE_set_);
    function("U_EMRELLIPSE_set", &U_EMRELLIPSE_set_);
    function("U_EMRFILLPATH_set", &U_EMRFILLPATH_set_);
    function("U_EMRSTROKEPATH_set", &U_EMRSTROKEPATH_set_);
    function("U_EMRSTROKEANDFILLPATH_set", &U_EMRSTROKEANDFILLPATH_set_);
    function("U_EMRSAVEDC_set", &U_EMRSAVEDC_set_);
    function("U_EMRBEGINPATH_set", &U_EMRBEGINPATH_set_);
    function("U_EMRENDPATH_set", &U_EMRENDPATH_set_);
    function("U_EMRCLOSEFIGURE_set", &U_EMRCLOSEFIGURE_set_);
}
