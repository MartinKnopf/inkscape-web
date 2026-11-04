// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/OpenTypeUtil.cpp, src/libnrtype/font-instance.cpp
// Embind API of text-module.wasm: the parts of Pango, FreeType and HarfBuzz that text layout
// (libnrtype) uses. HarfBuzz shapes and gives glyph metrics and outlines, FriBidi gives the bidi
// levels (as in pango_itemize), libunibreak the line, word and grapheme breaks (as in
// pango_get_log_attrs). src/text.ts wraps it with types.
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

extern "C" {
#include <fribidi.h>
#include <graphemebreak.h>
#include <linebreak.h>
#include <wordbreak.h>
}
#include <hb-ot.h>
#include <hb.h>

using emscripten::val;

namespace {

// A font face from font file data with one hb_font_t (scale = units per em, so all values
// are in font units; libnrtype divides by the units per em as FontInstance does).
struct Face {
    hb_blob_t *blob = nullptr;
    hb_face_t *face = nullptr;
    hb_font_t *font = nullptr;
    ~Face()
    {
        hb_font_destroy(font);
        hb_face_destroy(face);
        hb_blob_destroy(blob);
    }
};

std::unordered_map<int, std::unique_ptr<Face>> faces;
int next_face = 1;

Face *get(int id)
{
    auto it = faces.find(id);
    return it == faces.end() ? nullptr : it->second.get();
}

std::vector<uint32_t> to_codepoints(val const &array)
{
    return emscripten::convertJSArrayToNumberVector<uint32_t>(array);
}

template <typename T>
val to_typed_array(std::vector<T> const &v)
{
    // Copy out of the WASM heap: the view is invalid after the next allocation.
    return val(emscripten::typed_memory_view(v.size(), v.data())).call<val>("slice");
}

// Number of faces in a font file (a collection has several).
int face_count(std::string const &bytes)
{
    hb_blob_t *blob = hb_blob_create(bytes.data(), bytes.size(), HB_MEMORY_MODE_DUPLICATE, nullptr, nullptr);
    int n = hb_face_count(blob);
    hb_blob_destroy(blob);
    return n;
}

// Create a face from font file data; 0 if the data is not a font.
int face_create(std::string const &bytes, int index)
{
    auto f = std::make_unique<Face>();
    f->blob = hb_blob_create(bytes.data(), bytes.size(), HB_MEMORY_MODE_DUPLICATE, nullptr, nullptr);
    f->face = hb_face_create(f->blob, index);
    if (hb_face_get_glyph_count(f->face) == 0) {
        return 0;
    }
    f->font = hb_font_create(f->face);
    int upem = hb_face_get_upem(f->face);
    hb_font_set_scale(f->font, upem, upem);
    int id = next_face++;
    faces.emplace(id, std::move(f));
    return id;
}

// A new font of the face of id, for other variations (it shares the face data).
int face_clone(int id)
{
    auto f = get(id);
    if (!f) {
        return 0;
    }
    auto c = std::make_unique<Face>();
    c->blob = hb_blob_reference(f->blob);
    c->face = hb_face_reference(f->face);
    c->font = hb_font_create(c->face);
    int upem = hb_face_get_upem(c->face);
    hb_font_set_scale(c->font, upem, upem);
    int clone = next_face++;
    faces.emplace(clone, std::move(c));
    return clone;
}

void face_destroy(int id)
{
    faces.erase(id);
}

int upem(int id)
{
    auto f = get(id);
    return f ? hb_face_get_upem(f->face) : 0;
}

// The data of an OpenType table ("OS/2", "hhea", "post", ...), empty if missing.
val table(int id, std::string const &tag)
{
    auto f = get(id);
    if (!f || tag.size() != 4) {
        return val::global("Uint8Array").new_(0);
    }
    hb_blob_t *blob = hb_face_reference_table(f->face, hb_tag_from_string(tag.c_str(), 4));
    unsigned length = 0;
    char const *data = hb_blob_get_data(blob, &length);
    std::vector<uint8_t> copy(data, data + length);
    hb_blob_destroy(blob);
    return to_typed_array(copy);
}

// The OpenType tables of the face (as upstream readOpenTypeTableList), space separated.
std::string table_list(int id)
{
    auto f = get(id);
    if (!f) {
        return "";
    }
    std::string result;
    unsigned count = hb_face_get_table_tags(f->face, 0, nullptr, nullptr);
    std::vector<hb_tag_t> tags(count);
    hb_face_get_table_tags(f->face, 0, &count, tags.data());
    for (auto t : tags) {
        char s[5] = {};
        hb_tag_to_string(t, s);
        if (!result.empty()) {
            result += ' ';
        }
        result += s;
    }
    return result;
}

// Glyph of a Unicode character, 0 if the font has none (FT_Get_Char_Index).
unsigned nominal_glyph(int id, unsigned codepoint)
{
    auto f = get(id);
    hb_codepoint_t glyph = 0;
    if (!f || !hb_font_get_nominal_glyph(f->font, codepoint, &glyph)) {
        return 0;
    }
    return glyph;
}

// [h_advance, v_advance, x_bearing, y_bearing, width, height, has_extents, v_origin_x, v_origin_y]
// in font units (v_advance is negative downwards, as HarfBuzz returns it).
val glyph_metrics(int id, unsigned glyph)
{
    std::vector<double> m(9, 0.0);
    if (auto f = get(id)) {
        m[0] = hb_font_get_glyph_h_advance(f->font, glyph);
        m[1] = hb_font_get_glyph_v_advance(f->font, glyph);
        hb_glyph_extents_t extents;
        if (hb_font_get_glyph_extents(f->font, glyph, &extents)) {
            m[2] = extents.x_bearing;
            m[3] = extents.y_bearing;
            m[4] = extents.width;
            m[5] = extents.height;
            m[6] = 1;
        }
        hb_position_t x = 0, y = 0;
        hb_font_get_glyph_v_origin(f->font, glyph, &x, &y);
        m[7] = x;
        m[8] = y;
    }
    return to_typed_array(m);
}

bool has_v_extents(int id)
{
    auto f = get(id);
    hb_font_extents_t extents;
    return f && hb_font_get_v_extents(f->font, &extents);
}

// Glyph outline as SVG path data in font units, y up (font-instance.cpp hb_draw_* callbacks).
void draw_move_to(hb_draw_funcs_t *, void *data, hb_draw_state_t *, float x, float y, void *)
{
    auto &s = *static_cast<std::ostringstream *>(data);
    s << 'M' << x << ' ' << y;
}
void draw_line_to(hb_draw_funcs_t *, void *data, hb_draw_state_t *, float x, float y, void *)
{
    auto &s = *static_cast<std::ostringstream *>(data);
    s << 'L' << x << ' ' << y;
}
void draw_quadratic_to(hb_draw_funcs_t *, void *data, hb_draw_state_t *, float cx, float cy, float x, float y,
                       void *)
{
    auto &s = *static_cast<std::ostringstream *>(data);
    s << 'Q' << cx << ' ' << cy << ' ' << x << ' ' << y;
}
void draw_cubic_to(hb_draw_funcs_t *, void *data, hb_draw_state_t *, float c1x, float c1y, float c2x, float c2y,
                   float x, float y, void *)
{
    auto &s = *static_cast<std::ostringstream *>(data);
    s << 'C' << c1x << ' ' << c1y << ' ' << c2x << ' ' << c2y << ' ' << x << ' ' << y;
}
void draw_close_path(hb_draw_funcs_t *, void *data, hb_draw_state_t *, void *)
{
    *static_cast<std::ostringstream *>(data) << 'Z';
}

std::string glyph_path(int id, unsigned glyph)
{
    auto f = get(id);
    if (!f) {
        return "";
    }
    static hb_draw_funcs_t *funcs = [] {
        auto d = hb_draw_funcs_create();
        hb_draw_funcs_set_move_to_func(d, draw_move_to, nullptr, nullptr);
        hb_draw_funcs_set_line_to_func(d, draw_line_to, nullptr, nullptr);
        hb_draw_funcs_set_quadratic_to_func(d, draw_quadratic_to, nullptr, nullptr);
        hb_draw_funcs_set_cubic_to_func(d, draw_cubic_to, nullptr, nullptr);
        hb_draw_funcs_set_close_path_func(d, draw_close_path, nullptr, nullptr);
        hb_draw_funcs_make_immutable(d);
        return d;
    }();
    std::ostringstream s;
    s.imbue(std::locale::classic());
    hb_font_draw_glyph(f->font, glyph, funcs, &s);
    return s.str();
}

// Set the font variations ("wght=700,wdth=80"), as pango_font_description_set_variations.
void set_variations(int id, std::string const &variations)
{
    auto f = get(id);
    if (!f) {
        return;
    }
    std::vector<hb_variation_t> list;
    std::stringstream ss(variations);
    std::string item;
    while (std::getline(ss, item, ',')) {
        hb_variation_t v;
        if (hb_variation_from_string(item.c_str(), item.size(), &v)) {
            list.push_back(v);
        }
    }
    hb_font_set_variations(f->font, list.data(), list.size());
}

// Shape code points [offset, offset + length) of a paragraph (pango_shape_full, the rest is
// context): direction is an hb_direction_t, script an ISO 15924 tag, features a comma separated
// list in the hb_feature_from_string syntax. Returns [glyph, cluster, x_advance, y_advance,
// x_offset, y_offset] per glyph in font units; the cluster is the index of the first code point
// in the paragraph. Glyphs are in visual order for RTL (as Pango).
val shape(int id, val const &codepoints, int offset, int length, int direction, std::string const &script,
          std::string const &language, std::string const &features)
{
    std::vector<int32_t> out;
    auto f = get(id);
    if (!f) {
        return to_typed_array(out);
    }
    auto cps = to_codepoints(codepoints);
    hb_buffer_t *buffer = hb_buffer_create();
    hb_buffer_add_utf32(buffer, cps.data(), cps.size(), offset, length);
    hb_buffer_set_direction(buffer, static_cast<hb_direction_t>(direction));
    if (script.size() == 4) {
        hb_buffer_set_script(buffer, hb_script_from_string(script.c_str(), 4));
    }
    if (!language.empty()) {
        hb_buffer_set_language(buffer, hb_language_from_string(language.c_str(), language.size()));
    }
    hb_buffer_guess_segment_properties(buffer);
    std::vector<hb_feature_t> list;
    std::stringstream ss(features);
    std::string item;
    while (std::getline(ss, item, ',')) {
        hb_feature_t feature;
        if (hb_feature_from_string(item.c_str(), item.size(), &feature)) {
            list.push_back(feature);
        }
    }
    hb_shape(f->font, buffer, list.data(), list.size());
    unsigned count = 0;
    hb_glyph_info_t *info = hb_buffer_get_glyph_infos(buffer, &count);
    hb_glyph_position_t *pos = hb_buffer_get_glyph_positions(buffer, &count);
    out.reserve(count * 6);
    for (unsigned i = 0; i < count; i++) {
        out.push_back(info[i].codepoint);
        out.push_back(info[i].cluster);
        out.push_back(pos[i].x_advance);
        out.push_back(pos[i].y_advance);
        out.push_back(pos[i].x_offset);
        out.push_back(pos[i].y_offset);
    }
    hb_buffer_destroy(buffer);
    return to_typed_array(out);
}

// A string of the name table (hb_ot_name_get_utf8, upstream get_name_string).
std::string name(int id, int name_id)
{
    auto f = get(id);
    if (!f) {
        return "";
    }
    unsigned size = 1023;
    std::vector<char> buffer(size + 1);
    hb_ot_name_get_utf8(f->face, name_id, HB_LANGUAGE_INVALID, &size, buffer.data());
    return std::string(buffer.data());
}

// Upstream GlyphToUnicodeMap (OpenTypeUtil.cpp): the first code point mapped to a glyph.
class GlyphToUnicodeMap
{
public:
    explicit GlyphToUnicodeMap(Face *f)
        : font(f->font)
        , set(hb_set_create())
    {
        hb_face_collect_unicodes(f->face, set);
    }
    ~GlyphToUnicodeMap() { hb_set_destroy(set); }
    hb_codepoint_t lookup(hb_codepoint_t glyph)
    {
        if (auto it = mappings.find(glyph); it != mappings.end()) {
            return it->second;
        }
        while ((more = (more && hb_set_next(set, &codepoint)))) {
            hb_codepoint_t g;
            if (!hb_font_get_nominal_glyph(font, codepoint, &g)) {
                continue;
            }
            mappings.emplace(g, codepoint);
            if (g == glyph) {
                return codepoint;
            }
        }
        return 0;
    }

private:
    hb_font_t *font;
    hb_set_t *set;
    std::unordered_map<hb_codepoint_t, hb_codepoint_t> mappings;
    bool more = true;
    hb_codepoint_t codepoint = HB_SET_VALUE_INVALID;
};

void append_utf8(std::string &s, uint32_t c)
{
    if (c < 0x80) {
        s += char(c);
    } else if (c < 0x800) {
        s += char(0xc0 | (c >> 6));
        s += char(0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
        s += char(0xe0 | (c >> 12));
        s += char(0x80 | ((c >> 6) & 0x3f));
        s += char(0x80 | (c & 0x3f));
    } else {
        s += char(0xf0 | (c >> 18));
        s += char(0x80 | ((c >> 12) & 0x3f));
        s += char(0x80 | ((c >> 6) & 0x3f));
        s += char(0x80 | (c & 0x3f));
    }
}

void get_glyphs(GlyphToUnicodeMap &map, hb_set_t *set, std::string &characters)
{
    hb_codepoint_t glyph = HB_SET_VALUE_INVALID;
    while (hb_set_next(set, &glyph)) {
        if (auto codepoint = map.lookup(glyph)) {
            append_utf8(characters, codepoint);
        }
    }
}

std::string extract_tag(hb_tag_t tag)
{
    char s[5] = {};
    hb_tag_to_string(tag, s);
    return s;
}

struct OTSubstitution
{
    std::string before, input, after, output;
};

// Upstream readOpenTypeGsubTable: the GSUB features and, for the style, ligature and numeric
// features, the characters they substitute. One line per feature: tag \t before \t input \t
// after \t output.
std::string gsub_tables(int id)
{
    auto f = get(id);
    if (!f) {
        return "";
    }
    hb_face_t *hb_face = f->face;
    std::map<std::string, OTSubstitution> tables;

    auto script_count = hb_ot_layout_table_get_script_tags(hb_face, HB_OT_TAG_GSUB, 0, nullptr, nullptr);
    for (unsigned i = 0; i < script_count; ++i) {
        auto language_count = hb_ot_layout_script_get_language_tags(hb_face, HB_OT_TAG_GSUB, i, 0, nullptr, nullptr);
        auto add_features = [&](unsigned language_index) {
            auto feature_count =
                hb_ot_layout_language_get_feature_tags(hb_face, HB_OT_TAG_GSUB, i, language_index, 0, nullptr, nullptr);
            std::vector<hb_tag_t> features(feature_count + 1);
            hb_ot_layout_language_get_feature_tags(hb_face, HB_OT_TAG_GSUB, i, language_index, 0, &feature_count,
                                                   features.data());
            for (unsigned k = 0; k < feature_count; ++k) {
                tables[extract_tag(features[k])];
            }
        };
        if (language_count > 0) {
            for (unsigned j = 0; j < language_count; ++j) {
                add_features(j);
            }
        } else {
            add_features(HB_OT_LAYOUT_DEFAULT_LANGUAGE_INDEX);
        }
    }

    GlyphToUnicodeMap glyph_map(f);
    for (auto &[tag, substitution] : tables) {
        bool style = tag == "case" || tag == "salt" || tag == "swsh" || tag == "cwsh" || tag == "ornm" ||
                     tag == "nalt" || tag == "hist" || (tag[0] == 's' && tag[1] == 's' && !(tag[2] == 't')) ||
                     (tag[0] == 'c' && tag[1] == 'v');
        bool ligature = tag == "liga" || tag == "clig" || tag == "dlig" || tag == "hlig" || tag == "calt";
        bool numeric = tag == "lnum" || tag == "onum" || tag == "pnum" || tag == "tnum" || tag == "frac" ||
                       tag == "afrc" || tag == "ordn" || tag == "zero";
        if (!(style || ligature || numeric)) {
            continue;
        }
        unsigned feature_index;
        if (!hb_ot_layout_language_find_feature(hb_face, HB_OT_TAG_GSUB, 0, HB_OT_LAYOUT_DEFAULT_LANGUAGE_INDEX,
                                                hb_tag_from_string(tag.c_str(), 4), &feature_index)) {
            continue;
        }
        unsigned start_offset = 0;
        while (true) {
            unsigned lookup_indexes[32];
            unsigned lookup_count = 32;
            unsigned count = hb_ot_layout_feature_get_lookups(hb_face, HB_OT_TAG_GSUB, feature_index, start_offset,
                                                              &lookup_count, lookup_indexes);
            for (unsigned i = 0; i < lookup_count; i++) {
                hb_set_t *before = hb_set_create();
                hb_set_t *input = hb_set_create();
                hb_set_t *after = hb_set_create();
                hb_set_t *output = hb_set_create();
                hb_ot_layout_lookup_collect_glyphs(hb_face, HB_OT_TAG_GSUB, lookup_indexes[i], before, input, after,
                                                   output);
                get_glyphs(glyph_map, before, substitution.before);
                get_glyphs(glyph_map, input, substitution.input);
                get_glyphs(glyph_map, after, substitution.after);
                get_glyphs(glyph_map, output, substitution.output);
                hb_set_destroy(before);
                hb_set_destroy(input);
                hb_set_destroy(after);
                hb_set_destroy(output);
            }
            start_offset += lookup_count;
            if (lookup_count == 0 || start_offset >= count) {
                break;
            }
        }
    }

    std::string result;
    for (auto &[tag, s] : tables) {
        result += tag + '\t' + s.before + '\t' + s.input + '\t' + s.after + '\t' + s.output + '\n';
    }
    return result;
}

// Upstream readOpenTypeFvarAxes: one line per visible axis: tag \t name \t min \t default \t max \t value.
std::string var_axes(int id)
{
    auto f = get(id);
    if (!f || !hb_ot_var_has_data(f->face)) {
        return "";
    }
    unsigned axis_count = hb_ot_var_get_axis_count(f->face);
    std::vector<hb_ot_var_axis_info_t> axes(axis_count);
    hb_ot_var_get_axis_infos(f->face, 0, &axis_count, axes.data());
    unsigned coords_count = axis_count;
    auto coords = hb_font_get_var_coords_design(f->font, &coords_count);
    std::ostringstream s;
    s.imbue(std::locale::classic());
    for (unsigned i = 0; i < axis_count; ++i) {
        auto const &axis = axes[i];
        if (axis.flags & HB_OT_VAR_AXIS_FLAG_HIDDEN) {
            continue;
        }
        s << extract_tag(axis.tag) << '\t' << name(id, axis.name_id) << '\t' << axis.min_value << '\t'
          << axis.default_value << '\t' << axis.max_value << '\t' << (i < coords_count ? coords[i] : axis.default_value)
          << '\n';
    }
    return s.str();
}

// ISO 15924 script tag of each code point (as Pango's script iterator uses).
val scripts(val const &codepoints)
{
    auto cps = to_codepoints(codepoints);
    std::vector<uint32_t> out(cps.size());
    auto funcs = hb_unicode_funcs_get_default();
    for (size_t i = 0; i < cps.size(); i++) {
        out[i] = hb_unicode_script(funcs, cps[i]);
    }
    return to_typed_array(out);
}

// Bidi embedding level of each code point (FriBidi, as pango_itemize_with_base_dir).
val bidi_levels(val const &codepoints, bool rtl)
{
    auto cps = to_codepoints(codepoints);
    size_t n = cps.size();
    std::vector<FriBidiCharType> types(n);
    std::vector<FriBidiBracketType> brackets(n);
    std::vector<FriBidiLevel> levels(n);
    std::vector<uint8_t> out(n, rtl ? 1 : 0);
    if (n) {
        fribidi_get_bidi_types(cps.data(), n, types.data());
        fribidi_get_bracket_types(cps.data(), n, types.data(), brackets.data());
        FriBidiParType base = rtl ? FRIBIDI_PAR_RTL : FRIBIDI_PAR_LTR;
        if (fribidi_get_par_embedding_levels_ex(types.data(), brackets.data(), n, &base, levels.data())) {
            for (size_t i = 0; i < n; i++) {
                out[i] = levels[i];
            }
        }
    }
    return to_typed_array(out);
}

// libunibreak break opportunities after each code point (LINEBREAK_MUSTBREAK = 0,
// LINEBREAK_ALLOWBREAK = 1, LINEBREAK_NOBREAK = 2, LINEBREAK_INSIDEACHAR = 3).
val line_breaks(val const &codepoints, std::string const &language)
{
    auto cps = to_codepoints(codepoints);
    std::vector<char> brks(cps.size());
    if (!cps.empty()) {
        set_linebreaks_utf32(cps.data(), cps.size(), language.empty() ? nullptr : language.c_str(), brks.data());
    }
    return to_typed_array(std::vector<uint8_t>(brks.begin(), brks.end()));
}

// Word breaks after each code point (WORDBREAK_BREAK = 0, WORDBREAK_NOBREAK = 1, WORDBREAK_INSIDEACHAR = 2).
val word_breaks(val const &codepoints, std::string const &language)
{
    auto cps = to_codepoints(codepoints);
    std::vector<char> brks(cps.size());
    if (!cps.empty()) {
        set_wordbreaks_utf32(cps.data(), cps.size(), language.empty() ? nullptr : language.c_str(), brks.data());
    }
    return to_typed_array(std::vector<uint8_t>(brks.begin(), brks.end()));
}

// Grapheme cluster breaks after each code point (GRAPHEMEBREAK_BREAK = 0, ..._NOBREAK = 1).
val grapheme_breaks(val const &codepoints)
{
    auto cps = to_codepoints(codepoints);
    std::vector<char> brks(cps.size());
    if (!cps.empty()) {
        set_graphemebreaks_utf32(cps.data(), cps.size(), nullptr, brks.data());
    }
    return to_typed_array(std::vector<uint8_t>(brks.begin(), brks.end()));
}

} // namespace

EMSCRIPTEN_BINDINGS(text)
{
    init_linebreak();
    init_wordbreak();
    init_graphemebreak();
    emscripten::function("faceCount", &face_count);
    emscripten::function("faceCreate", &face_create);
    emscripten::function("faceClone", &face_clone);
    emscripten::function("faceDestroy", &face_destroy);
    emscripten::function("upem", &upem);
    emscripten::function("table", &table);
    emscripten::function("tableList", &table_list);
    emscripten::function("nominalGlyph", &nominal_glyph);
    emscripten::function("glyphMetrics", &glyph_metrics);
    emscripten::function("hasVExtents", &has_v_extents);
    emscripten::function("glyphPath", &glyph_path);
    emscripten::function("setVariations", &set_variations);
    emscripten::function("shape", &shape);
    emscripten::function("name", &name);
    emscripten::function("gsubTables", &gsub_tables);
    emscripten::function("varAxes", &var_axes);
    emscripten::function("scripts", &scripts);
    emscripten::function("bidiLevels", &bidi_levels);
    emscripten::function("lineBreaks", &line_breaks);
    emscripten::function("wordBreaks", &word_breaks);
    emscripten::function("graphemeBreaks", &grapheme_breaks);
}
