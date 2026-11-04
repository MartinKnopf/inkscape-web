// SPDX-License-Identifier: GPL-2.0-or-later
// FontFactory and the Pango font descriptions for the PDF import (poppler-utils.cpp). Upstream
// asks fontconfig for the installed fonts; here the app passes the list of local fonts (Local
// Font Access API) with set_local_fonts() before an import.
#pragma once
#include <string>
#include <vector>

enum PangoStyle { PANGO_STYLE_NORMAL, PANGO_STYLE_OBLIQUE, PANGO_STYLE_ITALIC };
enum PangoWeight {
    PANGO_WEIGHT_THIN = 100,
    PANGO_WEIGHT_ULTRALIGHT = 200,
    PANGO_WEIGHT_LIGHT = 300,
    PANGO_WEIGHT_SEMILIGHT = 350,
    PANGO_WEIGHT_BOOK = 380,
    PANGO_WEIGHT_NORMAL = 400,
    PANGO_WEIGHT_MEDIUM = 500,
    PANGO_WEIGHT_SEMIBOLD = 600,
    PANGO_WEIGHT_BOLD = 700,
    PANGO_WEIGHT_ULTRABOLD = 800,
    PANGO_WEIGHT_HEAVY = 900,
    PANGO_WEIGHT_ULTRAHEAVY = 1000
};
enum PangoStretch {
    PANGO_STRETCH_ULTRA_CONDENSED,
    PANGO_STRETCH_EXTRA_CONDENSED,
    PANGO_STRETCH_CONDENSED,
    PANGO_STRETCH_SEMI_CONDENSED,
    PANGO_STRETCH_NORMAL,
    PANGO_STRETCH_SEMI_EXPANDED,
    PANGO_STRETCH_EXPANDED,
    PANGO_STRETCH_EXTRA_EXPANDED,
    PANGO_STRETCH_ULTRA_EXPANDED
};

struct PangoFontDescription
{
    std::string family;
    PangoStyle style = PANGO_STYLE_NORMAL;
    int weight = PANGO_WEIGHT_NORMAL;
    PangoStretch stretch = PANGO_STRETCH_NORMAL;
};

/** Parse "Family Style-Words Size" as Pango does (the style words at the end). */
PangoFontDescription *pango_font_description_from_string(char const *str);
char *pango_font_description_to_string(PangoFontDescription const *desc);
inline char const *pango_font_description_get_family(PangoFontDescription const *desc)
{
    return desc->family.empty() ? nullptr : desc->family.c_str();
}
inline PangoStyle pango_font_description_get_style(PangoFontDescription const *desc)
{
    return desc->style;
}
inline PangoWeight pango_font_description_get_weight(PangoFontDescription const *desc)
{
    return static_cast<PangoWeight>(desc->weight);
}
inline PangoStretch pango_font_description_get_stretch(PangoFontDescription const *desc)
{
    return desc->stretch;
}

/** A local font: its family, its style name ("Bold Italic") and its PostScript name. */
struct LocalFont
{
    std::string family;
    std::string style;
    std::string postscript_name;
};
void set_local_fonts(std::vector<LocalFont> fonts);

class FontFactory
{
public:
    static FontFactory &get();
    /**
     * The description of the local font with the PostScript name; with substitute, of the
     * local font that fits the name best. Null if there is none.
     */
    PangoFontDescription *parsePostscriptName(std::string const &name, bool substitute);
    bool hasFontFamily(std::string const &family);
};
