// SPDX-License-Identifier: GPL-2.0-or-later
// FontFactory and the Pango font descriptions of the PDF import shim (libnrtype/font-factory.h).
#include <algorithm>
#include <cctype>
#include <cstring>
#include <sstream>
#include "libnrtype/font-factory.h"

namespace {

std::vector<LocalFont> local_fonts;

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}

/** Lower case without spaces, dashes and underscores, for comparing names. */
std::string key(std::string const &s)
{
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c))
            out += std::tolower(c);
    }
    return out;
}

/** Apply a Pango style word to desc; false if it is not one. */
bool apply_style_word(PangoFontDescription &desc, std::string const &word)
{
    static std::pair<char const *, int> const weights[] = {
        {"thin", 100},       {"ultralight", 200}, {"ultra-light", 200}, {"extralight", 200}, {"extra-light", 200},
        {"light", 300},      {"semilight", 350},  {"semi-light", 350},  {"demilight", 350},  {"demi-light", 350},
        {"book", 380},       {"regular", 400},    {"medium", 500},      {"semibold", 600},   {"semi-bold", 600},
        {"demibold", 600},   {"demi-bold", 600},  {"bold", 700},        {"ultrabold", 800},  {"ultra-bold", 800},
        {"extrabold", 800},  {"extra-bold", 800}, {"heavy", 900},       {"black", 900},      {"ultrablack", 1000},
        {"ultra-black", 1000}, {"extrablack", 1000}, {"extra-black", 1000},
    };
    static std::pair<char const *, PangoStretch> const stretches[] = {
        {"ultra-condensed", PANGO_STRETCH_ULTRA_CONDENSED}, {"extra-condensed", PANGO_STRETCH_EXTRA_CONDENSED},
        {"condensed", PANGO_STRETCH_CONDENSED},             {"semi-condensed", PANGO_STRETCH_SEMI_CONDENSED},
        {"semi-expanded", PANGO_STRETCH_SEMI_EXPANDED},     {"expanded", PANGO_STRETCH_EXPANDED},
        {"extra-expanded", PANGO_STRETCH_EXTRA_EXPANDED},   {"ultra-expanded", PANGO_STRETCH_ULTRA_EXPANDED},
    };
    auto w = lower(word);
    if (w == "normal" || w == "roman")
        return true;
    if (w == "italic") {
        desc.style = PANGO_STYLE_ITALIC;
        return true;
    }
    if (w == "oblique") {
        desc.style = PANGO_STYLE_OBLIQUE;
        return true;
    }
    for (auto &[name, value] : weights) {
        if (w == name) {
            desc.weight = value;
            return true;
        }
    }
    for (auto &[name, value] : stretches) {
        if (w == name) {
            desc.stretch = value;
            return true;
        }
    }
    return false;
}

PangoFontDescription *describe(LocalFont const &font)
{
    auto desc = new PangoFontDescription;
    desc->family = font.family;
    std::istringstream words(font.style);
    for (std::string word; words >> word;)
        apply_style_word(*desc, word);
    return desc;
}

} // namespace

void set_local_fonts(std::vector<LocalFont> fonts)
{
    local_fonts = std::move(fonts);
}

PangoFontDescription *pango_font_description_from_string(char const *str)
{
    std::vector<std::string> words;
    std::istringstream in(str ? str : "");
    for (std::string word; in >> word;)
        words.push_back(word);
    auto desc = new PangoFontDescription;
    // The style words and the size are at the end; the rest is the family.
    while (!words.empty()) {
        auto &w = words.back();
        bool size = !w.empty() && std::all_of(w.begin(), w.end(), [](char c) { return std::isdigit(c) || c == '.'; });
        if (!size && !apply_style_word(*desc, w))
            break;
        words.pop_back();
    }
    for (size_t i = 0; i < words.size(); i++)
        desc->family += (i ? " " : "") + words[i];
    if (!desc->family.empty() && desc->family.back() == ',')
        desc->family.pop_back();
    return desc;
}

char *pango_font_description_to_string(PangoFontDescription const *desc)
{
    std::string out = desc->family;
    if (desc->weight != PANGO_WEIGHT_NORMAL)
        out += desc->weight >= 700 ? " Bold" : desc->weight <= 300 ? " Light" : " " + std::to_string(desc->weight);
    if (desc->style == PANGO_STYLE_ITALIC)
        out += " Italic";
    else if (desc->style == PANGO_STYLE_OBLIQUE)
        out += " Oblique";
    if (desc->stretch < PANGO_STRETCH_NORMAL)
        out += " Condensed";
    else if (desc->stretch > PANGO_STRETCH_NORMAL)
        out += " Expanded";
    return strdup(out.c_str());
}

FontFactory &FontFactory::get()
{
    static FontFactory factory;
    return factory;
}

PangoFontDescription *FontFactory::parsePostscriptName(std::string const &name, bool substitute)
{
    for (auto &font : local_fonts) {
        if (font.postscript_name == name)
            return describe(font);
    }
    if (!substitute || local_fonts.empty())
        return nullptr;
    // Like fontconfig: the font whose family starts the name ("ArialMT" -> Arial), else the first.
    auto family_key = key(name.substr(0, name.find('-')));
    LocalFont const *best = nullptr;
    size_t best_len = 0;
    for (auto &font : local_fonts) {
        auto k = key(font.family);
        if (!k.empty() && family_key.starts_with(k) && k.size() > best_len) {
            best = &font;
            best_len = k.size();
        }
    }
    return best ? describe(*best) : nullptr;
}

bool FontFactory::hasFontFamily(std::string const &family)
{
    auto k = lower(family);
    return std::any_of(local_fonts.begin(), local_fonts.end(), [&](auto &f) { return lower(f.family) == k; });
}
