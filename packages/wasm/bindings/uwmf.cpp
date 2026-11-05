// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/3rdparty/libuemf/
// Embind API of uemf-module.wasm, part 2: the WMF functions of libuemf that wmf-print.cpp uses,
// with the same names, for the TypeScript PrintWmf (packages/editor/src/extension/internal/
// wmf-print.ts). The conventions are those of uemf.cpp: structs go by value as JavaScript
// objects, records, WMFTRACK, WMFHANDLES and other buffers are pointers (numbers), and functions
// with output parameters return an object with the outputs. The shared helpers (free, read_file,
// RGBA_to_DIB, bitmapinfo_set, U_Utf8ToUtf16le, UnicodeToNon ...) and the value objects
// U_COLORREF and U_BITMAPINFOHEADER are registered in uemf.cpp.
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <libuemf/uwmf.h>

using emscripten::val;

namespace {

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

template <typename T>
std::vector<T> vec(val const &array)
{
    return emscripten::vecFromJSArray<T>(array);
}

val handle_record(char *rec, uint32_t ih)
{
    val out = val::object();
    out.set("rec", ptr(rec));
    out.set("ih", ih);
    return out;
}

// ---- WMF file ----

val wmf_start_(std::string const &name, uint32_t initsize, uint32_t chunksize)
{
    WMFTRACK *wt = nullptr;
    int status = wmf_start(name.c_str(), initsize, chunksize, &wt);
    val out = val::object();
    out.set("status", status);
    out.set("wt", ptr(wt));
    return out;
}

int wmf_finish_(uintptr_t wt)
{
    return wmf_finish(to<WMFTRACK>(wt));
}

int uwmf_free_(uintptr_t wt)
{
    auto p = to<WMFTRACK>(wt);
    return uwmf_free(&p);
}

int wmf_append_(uintptr_t rec, uintptr_t wt, int freerec)
{
    return wmf_append(to<U_METARECORD>(rec), to<WMFTRACK>(wt), freerec);
}

int wmf_header_append_(uintptr_t rec, uintptr_t wt, int freerec)
{
    return wmf_header_append(to<U_METARECORD>(rec), to<WMFTRACK>(wt), freerec);
}

uintptr_t wmf_htable_create_(uint32_t initsize, uint32_t chunksize)
{
    WMFHANDLES *wht = nullptr;
    wmf_htable_create(initsize, chunksize, &wht);
    return ptr(wht);
}

int wmf_htable_free_(uintptr_t wht)
{
    auto p = to<WMFHANDLES>(wht);
    return wmf_htable_free(&p);
}

uintptr_t U_PAIRF_set_(float x, float y)
{
    return ptr(U_PAIRF_set(x, y));
}

// ---- Text ----
// libuemf converts to Latin1 with iconv_open("LATIN1//TRANSLIT", ...), which the musl iconv of
// Emscripten does not open (the functions then always return NULL). These replacements convert
// the code points without iconv; a code point above 0xFF becomes '?' (glibc TRANSLIT gives '?'
// for the characters that it cannot transliterate).

/** The code points as a malloc() Latin1 string. */
uintptr_t to_latin1(std::vector<uint32_t> const &cps)
{
    char *dst = static_cast<char *>(std::malloc(cps.size() + 1));
    size_t n = 0;
    for (uint32_t cp : cps) {
        dst[n++] = cp <= 0xFF ? static_cast<char>(cp) : '?';
    }
    dst[n] = 0;
    return ptr(dst);
}

/** U_Utf8ToLatin1(src, 0, nullptr): a malloc() buffer. */
uintptr_t U_Utf8ToLatin1_(std::string const &src)
{
    std::vector<uint32_t> cps;
    for (size_t i = 0; i < src.size();) {
        auto c = static_cast<unsigned char>(src[i]);
        int n = c < 0x80 ? 0 : c < 0xE0 ? 1 : c < 0xF0 ? 2 : 3;
        uint32_t cp = n ? c & (0x3F >> n) : c;
        for (int k = 1; k <= n && i + k < src.size(); k++) {
            cp = (cp << 6) | (static_cast<unsigned char>(src[i + k]) & 0x3F);
        }
        cps.push_back(cp);
        i += n + 1;
    }
    return to_latin1(cps);
}

/** U_Utf16leToLatin1(src, 0, nullptr): a malloc() buffer, 0 for NULL. */
uintptr_t U_Utf16leToLatin1_(uintptr_t src)
{
    auto s = to<uint16_t const>(src);
    if (!s) {
        return 0;
    }
    std::vector<uint32_t> cps;
    for (; *s; s++) {
        uint32_t cp = *s;
        if (cp >= 0xD800 && cp < 0xDC00 && s[1] >= 0xDC00 && s[1] < 0xE000) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (*++s - 0xDC00); // surrogate pair
        }
        cps.push_back(cp);
    }
    return to_latin1(cps);
}

// ---- Objects ----

/** U_PEN_set() with the width as one value (U_PEN keeps it in Widthw[0]). */
uint16_t pen_width(U_PEN const &p)
{
    return p.Widthw[0];
}

void set_pen_width(U_PEN &p, uint16_t w)
{
    p.Widthw[0] = w;
    p.Widthw[1] = 0;
}

uintptr_t wselectobject_set_(uint32_t ihObject, uintptr_t wht)
{
    return ptr(wselectobject_set(ihObject, to<WMFHANDLES>(wht)));
}

uintptr_t wdeleteobject_set_(uint32_t ihObject, uintptr_t wht)
{
    return ptr(wdeleteobject_set(&ihObject, to<WMFHANDLES>(wht)));
}

val wcreatepenindirect_set_(uintptr_t wht, U_PEN pen)
{
    uint32_t ih = 0;
    char *rec = wcreatepenindirect_set(&ih, to<WMFHANDLES>(wht), pen);
    return handle_record(rec, ih);
}

val wcreatebrushindirect_set_(uintptr_t wht, U_WLOGBRUSH lb)
{
    uint32_t ih = 0;
    char *rec = wcreatebrushindirect_set(&ih, to<WMFHANDLES>(wht), lb);
    return handle_record(rec, ih);
}

val wcreatedibpatternbrush_srcdib_set_(uintptr_t wht, uint32_t iUsage, uintptr_t Bmi, uint32_t cbPx, uintptr_t Px)
{
    uint32_t ih = 0;
    char *rec = wcreatedibpatternbrush_srcdib_set(&ih, to<WMFHANDLES>(wht), iUsage, to<U_BITMAPINFO const>(Bmi), cbPx,
                                                  to<char const>(Px));
    return handle_record(rec, ih);
}

/** U_FONT_set(): a malloc() U_FONT; FaceName is a Latin1 malloc() buffer. */
uintptr_t U_FONT_set_(int16_t Height, int16_t Width, int16_t Escapement, int16_t Orientation, int16_t Weight,
                      uint8_t Italic, uint8_t Underline, uint8_t StrikeOut, uint8_t CharSet, uint8_t OutPrecision,
                      uint8_t ClipPrecision, uint8_t Quality, uint8_t PitchAndFamily, uintptr_t FaceName)
{
    return ptr(U_FONT_set(Height, Width, Escapement, Orientation, Weight, Italic, Underline, StrikeOut, CharSet,
                          OutPrecision, ClipPrecision, Quality, PitchAndFamily, to<char>(FaceName)));
}

val wcreatefontindirect_set_(uintptr_t wht, uintptr_t uf)
{
    uint32_t ih = 0;
    char *rec = wcreatefontindirect_set(&ih, to<WMFHANDLES>(wht), to<U_FONT>(uf));
    return handle_record(rec, ih);
}

uintptr_t wmiterlimit_set_(int32_t limit)
{
    return ptr(wmiterlimit_set(limit));
}

// ---- Records ----

uintptr_t U_WMRHEADER_set_(uintptr_t size, unsigned int dpi)
{
    return ptr(U_WMRHEADER_set(to<U_PAIRF>(size), dpi));
}

uintptr_t U_WMRPOLYGON_set_(val const &pts)
{
    auto p = vec<U_POINT16>(pts);
    return ptr(U_WMRPOLYGON_set(p.size(), p.data()));
}

uintptr_t U_WMRPOLYLINE_set_(val const &pts)
{
    auto p = vec<U_POINT16>(pts);
    return ptr(U_WMRPOLYLINE_set(p.size(), p.data()));
}

uintptr_t U_WMRPOLYPOLYGON_set_(val const &aPolyCounts, val const &pts)
{
    auto n = vec<uint16_t>(aPolyCounts);
    auto p = vec<U_POINT16>(pts);
    return ptr(U_WMRPOLYPOLYGON_set(n.size(), n.data(), p.data()));
}

uintptr_t U_WMRSTRETCHDIB_set_(U_POINT16 Dest, U_POINT16 cDest, U_POINT16 Src, U_POINT16 cSrc, uint16_t cUsage,
                               uint32_t dwRop3, uintptr_t Bmi, uint32_t cbPx, uintptr_t Px)
{
    return ptr(U_WMRSTRETCHDIB_set(Dest, cDest, Src, cSrc, cUsage, dwRop3, to<U_BITMAPINFO const>(Bmi), cbPx,
                                   to<char const>(Px)));
}

uintptr_t U_WMREXTTEXTOUT_set_(U_POINT16 Dst, int16_t Length, uint16_t Opts, uintptr_t string, val const &dx,
                               U_RECT16 rect)
{
    auto d = vec<int16_t>(dx);
    return ptr(U_WMREXTTEXTOUT_set(Dst, Length, Opts, to<char const>(string), d.empty() ? nullptr : d.data(), rect));
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
REC1(U_WMRSETWINDOWEXT_set, U_POINT16)
REC1(U_WMRSETWINDOWORG_set, U_POINT16)
REC1(U_WMRMOVETO_set, U_POINT16)
REC1(U_WMRLINETO_set, U_POINT16)
REC1(U_WMRSETMAPMODE_set, uint16_t)
REC1(U_WMRSETBKMODE_set, uint16_t)
REC1(U_WMRSETPOLYFILLMODE_set, uint16_t)
REC1(U_WMRSETTEXTALIGN_set, uint16_t)
REC1(U_WMRSETROP2_set, uint16_t)
REC1(U_WMRSETSTRETCHBLTMODE_set, uint16_t)
REC1(U_WMRSETTEXTCOLOR_set, U_COLORREF)
REC1(U_WMRSETBKCOLOR_set, U_COLORREF)
REC1(U_WMRRECTANGLE_set, U_RECT16)
REC1(U_WMRELLIPSE_set, U_RECT16)
REC0(U_WMREOF_set)

} // namespace

EMSCRIPTEN_BINDINGS(uwmf)
{
    using emscripten::function;
    using emscripten::value_object;

    value_object<U_POINT16>("U_POINT16").field("x", &U_POINT16::x).field("y", &U_POINT16::y);
    value_object<U_RECT16>("U_RECT16")
        .field("left", &U_RECT16::left)
        .field("top", &U_RECT16::top)
        .field("right", &U_RECT16::right)
        .field("bottom", &U_RECT16::bottom);
    value_object<U_PEN>("U_PEN")
        .field("Style", &U_PEN::Style)
        .field("Width", &pen_width, &set_pen_width)
        .field("Color", &U_PEN::Color);
    value_object<U_WLOGBRUSH>("U_WLOGBRUSH")
        .field("Style", &U_WLOGBRUSH::Style)
        .field("Color", &U_WLOGBRUSH::Color)
        .field("Hatch", &U_WLOGBRUSH::Hatch);

    function("wmf_start", &wmf_start_);
    function("wmf_finish", &wmf_finish_);
    function("uwmf_free", &uwmf_free_);
    function("wmf_append", &wmf_append_);
    function("wmf_header_append", &wmf_header_append_);
    function("wmf_htable_create", &wmf_htable_create_);
    function("wmf_htable_free", &wmf_htable_free_);
    function("U_PAIRF_set", &U_PAIRF_set_);

    function("U_Utf8ToLatin1", &U_Utf8ToLatin1_);
    function("U_Utf16leToLatin1", &U_Utf16leToLatin1_);

    function("wselectobject_set", &wselectobject_set_);
    function("wdeleteobject_set", &wdeleteobject_set_);
    function("wcreatepenindirect_set", &wcreatepenindirect_set_);
    function("wcreatebrushindirect_set", &wcreatebrushindirect_set_);
    function("wcreatedibpatternbrush_srcdib_set", &wcreatedibpatternbrush_srcdib_set_);
    function("U_FONT_set", &U_FONT_set_);
    function("wcreatefontindirect_set", &wcreatefontindirect_set_);
    function("wmiterlimit_set", &wmiterlimit_set_);

    function("U_WMRHEADER_set", &U_WMRHEADER_set_);
    function("U_WMRPOLYGON_set", &U_WMRPOLYGON_set_);
    function("U_WMRPOLYLINE_set", &U_WMRPOLYLINE_set_);
    function("U_WMRPOLYPOLYGON_set", &U_WMRPOLYPOLYGON_set_);
    function("U_WMRSTRETCHDIB_set", &U_WMRSTRETCHDIB_set_);
    function("U_WMREXTTEXTOUT_set", &U_WMREXTTEXTOUT_set_);
    function("U_WMRSETWINDOWEXT_set", &U_WMRSETWINDOWEXT_set_);
    function("U_WMRSETWINDOWORG_set", &U_WMRSETWINDOWORG_set_);
    function("U_WMRMOVETO_set", &U_WMRMOVETO_set_);
    function("U_WMRLINETO_set", &U_WMRLINETO_set_);
    function("U_WMRSETMAPMODE_set", &U_WMRSETMAPMODE_set_);
    function("U_WMRSETBKMODE_set", &U_WMRSETBKMODE_set_);
    function("U_WMRSETPOLYFILLMODE_set", &U_WMRSETPOLYFILLMODE_set_);
    function("U_WMRSETTEXTALIGN_set", &U_WMRSETTEXTALIGN_set_);
    function("U_WMRSETROP2_set", &U_WMRSETROP2_set_);
    function("U_WMRSETSTRETCHBLTMODE_set", &U_WMRSETSTRETCHBLTMODE_set_);
    function("U_WMRSETTEXTCOLOR_set", &U_WMRSETTEXTCOLOR_set_);
    function("U_WMRSETBKCOLOR_set", &U_WMRSETBKCOLOR_set_);
    function("U_WMRRECTANGLE_set", &U_WMRRECTANGLE_set_);
    function("U_WMRELLIPSE_set", &U_WMRELLIPSE_set_);
    function("U_WMREOF_set", &U_WMREOF_set_);
}
