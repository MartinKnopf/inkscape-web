// SPDX-License-Identifier: GPL-2.0-or-later
// The fontconfig functions of shim/uemf/fontconfig/fontconfig.h: a font list that the app
// fills (FcShimAddFont) and a simple match: the same family first, else the bundled
// family of the same kind (serif, monospace or sans-serif), then the nearest weight and
// slant. The character sets come from FreeType.
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include <ft2build.h>
#include FT_FREETYPE_H
#include "fontconfig/fontconfig.h"

struct _FcCharSet
{
    std::string file;
    FT_Face face = nullptr;
};

struct _FcPattern
{
    std::map<std::string, std::string> strings;
    std::map<std::string, double> numbers;
    _FcCharSet *charset = nullptr; // owned by the font list
};

namespace {

struct Font
{
    _FcPattern pattern;
    _FcCharSet charset;
};

std::vector<Font *> &fonts()
{
    static std::vector<Font *> list;
    return list;
}

FT_Library library()
{
    static FT_Library lib = nullptr;
    if (!lib)
        FT_Init_FreeType(&lib);
    return lib;
}

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}

/** 0 sans-serif, 1 serif, 2 monospace (the generic family of a font name). */
int generic(std::string const &family)
{
    auto f = lower(family);
    for (char const *mono : {"mono", "courier", "consol", "fixed", "typewriter", "lucida console"})
        if (f.find(mono) != std::string::npos)
            return 2;
    for (char const *serif : {"serif", "times", "roman", "georgia", "garamond", "cambria", "book", "palatino",
                              "century", "bodoni", "baskerville"})
        if (f.find(serif) != std::string::npos && f.find("sans") == std::string::npos)
            return 1;
    return 0;
}

double number(_FcPattern const *p, char const *key, double def)
{
    auto it = p->numbers.find(key);
    return it == p->numbers.end() ? def : it->second;
}

} // namespace

extern "C" {

void FcShimAddFont(char const *file, char const *family, char const *style, int weight, int slant)
{
    auto font = new Font;
    font->pattern.strings[FC_FILE] = file;
    font->pattern.strings[FC_FAMILY] = family;
    font->pattern.strings[FC_STYLE] = style;
    font->pattern.strings[FC_FULLNAME] = std::string(family) + (std::strcmp(style, "Book") ? " " + std::string(style) : "");
    font->pattern.numbers[FC_WEIGHT] = weight;
    font->pattern.numbers[FC_SLANT] = slant;
    font->charset.file = file;
    font->pattern.charset = &font->charset;
    fonts().push_back(font);
}

FcBool FcInit(void)
{
    return FcTrue;
}

void FcFini(void) {}

FcPattern *FcNameParse(FcChar8 const *name)
{
    auto p = new _FcPattern;
    std::string spec(reinterpret_cast<char const *>(name));
    size_t colon = spec.find(':');
    p->strings[FC_FAMILY] = spec.substr(0, colon);
    while (colon != std::string::npos) {
        size_t next = spec.find(':', colon + 1);
        std::string item = spec.substr(colon + 1, next == std::string::npos ? next : next - colon - 1);
        size_t eq = item.find('=');
        if (eq != std::string::npos)
            p->numbers[item.substr(0, eq)] = std::atof(item.c_str() + eq + 1);
        colon = next;
    }
    return p;
}

FcBool FcConfigSubstitute(FcConfig *, FcPattern *, FcMatchKind)
{
    return FcTrue;
}

void FcDefaultSubstitute(FcPattern *pattern)
{
    pattern->numbers.emplace(FC_SIZE, 12.0);
    pattern->numbers.emplace(FC_WEIGHT, 80.0);
    pattern->numbers.emplace(FC_SLANT, 0.0);
}

FcFontSet *FcFontSort(FcConfig *, FcPattern *p, FcBool, FcCharSet **, FcResult *result)
{
    auto family = lower(p->strings[FC_FAMILY]);
    int kind = generic(family);
    double weight = number(p, FC_WEIGHT, 80);
    double slant = number(p, FC_SLANT, 0);
    std::vector<std::pair<double, Font *>> scored;
    for (auto font : fonts()) {
        auto const &name = font->pattern.strings[FC_FAMILY];
        double score = lower(name) == family ? 0 : generic(name) == kind ? 1000 : 2000;
        score += std::abs(number(&font->pattern, FC_WEIGHT, 80) - weight);
        score += std::abs(number(&font->pattern, FC_SLANT, 0) - slant) * 2;
        scored.emplace_back(score, font);
    }
    std::stable_sort(scored.begin(), scored.end(), [](auto &a, auto &b) { return a.first < b.first; });
    auto set = new FcFontSet;
    set->nfont = set->sfont = int(scored.size());
    set->fonts = new FcPattern *[scored.size() + 1];
    for (size_t i = 0; i < scored.size(); i++)
        set->fonts[i] = new _FcPattern(scored[i].second->pattern);
    *result = scored.empty() ? FcResultNoMatch : FcResultMatch;
    return set;
}

FcPattern *FcFontRenderPrepare(FcConfig *, FcPattern *pat, FcPattern *font)
{
    auto p = new _FcPattern(*font);
    p->numbers[FC_SIZE] = number(pat, FC_SIZE, 12);
    return p;
}

FcResult FcPatternGetString(FcPattern const *p, char const *object, int n, FcChar8 **s)
{
    auto it = p->strings.find(object);
    if (n || it == p->strings.end())
        return FcResultNoMatch;
    *s = reinterpret_cast<FcChar8 *>(const_cast<char *>(it->second.c_str()));
    return FcResultMatch;
}

FcResult FcPatternGetDouble(FcPattern const *p, char const *object, int n, double *d)
{
    auto it = p->numbers.find(object);
    if (n || it == p->numbers.end())
        return FcResultNoMatch;
    *d = it->second;
    return FcResultMatch;
}

FcResult FcPatternGetInteger(FcPattern const *p, char const *object, int n, int *i)
{
    double d;
    FcResult r = FcPatternGetDouble(p, object, n, &d);
    if (r == FcResultMatch)
        *i = int(d);
    return r;
}

FcResult FcPatternGetBool(FcPattern const *, char const *, int, FcBool *)
{
    return FcResultNoMatch;
}

FcResult FcPatternGetCharSet(FcPattern const *p, char const *object, int n, FcCharSet **c)
{
    if (n || std::strcmp(object, FC_CHARSET) || !p->charset)
        return FcResultNoMatch;
    *c = p->charset;
    return FcResultMatch;
}

FcBool FcCharSetHasChar(FcCharSet const *fcs, FcChar32 ucs4)
{
    auto cs = const_cast<FcCharSet *>(fcs);
    if (!cs->face && FT_New_Face(library(), cs->file.c_str(), 0, &cs->face))
        return FcFalse;
    return FT_Get_Char_Index(cs->face, ucs4) != 0;
}

void FcPatternDestroy(FcPattern *p)
{
    delete p;
}

void FcFontSetDestroy(FcFontSet *s)
{
    for (int i = 0; i < s->nfont; i++)
        delete s->fonts[i];
    delete[] s->fonts;
    delete s;
}

} // extern "C"
