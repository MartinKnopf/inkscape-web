// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for cairo-module: thin bindings of the cairo functions that the cairo renderer
// (src/extension/internal/cairo-render-context.cpp, ported to TypeScript) calls. Cairo objects
// go to JavaScript as pointers (numbers); src/cairo.ts wraps them with types.
// PDF and PostScript surfaces write into memory; cairoSurfaceTakeOutput() returns the bytes.
// Fonts come from font files (FreeType), as upstream with cairo_ft_font_face_create_for_pattern().
#include <cstdint>
#include <map>
#include <vector>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cairo.h>
#include <cairo-ft.h>
#include <cairo-pdf.h>
#include <cairo-ps.h>
#include <ft2build.h>
#include FT_FREETYPE_H

using emscripten::val;

namespace {

using ptr = uintptr_t;

template <typename T>
T *P(ptr p)
{
    return reinterpret_cast<T *>(p);
}

cairo_t *CR(ptr p) { return P<cairo_t>(p); }

val bytes_out(unsigned char const *data, size_t size)
{
    return val(emscripten::typed_memory_view(size, data)).call<val>("slice");
}

std::vector<unsigned char> bytes_in(val const &bytes)
{
    return emscripten::convertJSArrayToNumberVector<unsigned char>(bytes);
}

// --- Output streams of the vector surfaces ---

std::map<cairo_surface_t *, std::vector<unsigned char> *> streams;

cairo_status_t write_callback(void *closure, unsigned char const *data, unsigned int length)
{
    auto out = static_cast<std::vector<unsigned char> *>(closure);
    out->insert(out->end(), data, data + length);
    return CAIRO_STATUS_SUCCESS;
}

ptr pdf_surface_create(double width, double height)
{
    auto out = new std::vector<unsigned char>;
    auto surface = cairo_pdf_surface_create_for_stream(write_callback, out, width, height);
    streams[surface] = out;
    return ptr(surface);
}

ptr ps_surface_create(double width, double height)
{
    auto out = new std::vector<unsigned char>;
    auto surface = cairo_ps_surface_create_for_stream(write_callback, out, width, height);
    streams[surface] = out;
    return ptr(surface);
}

/** The bytes that a PDF or PS surface wrote (all of them after cairo_surface_finish()). */
val surface_take_output(ptr surface)
{
    auto it = streams.find(P<cairo_surface_t>(surface));
    if (it == streams.end()) {
        return val::null();
    }
    auto result = bytes_out(it->second->data(), it->second->size());
    it->second->clear();
    return result;
}

void surface_destroy(ptr surface)
{
    auto s = P<cairo_surface_t>(surface);
    if (cairo_surface_get_reference_count(s) == 1) {
        if (auto it = streams.find(s); it != streams.end()) {
            delete it->second;
            streams.erase(it);
        }
    }
    cairo_surface_destroy(s);
}

// --- Image surfaces ---

/** An ARGB32 surface from RGBA bytes (not premultiplied, row by row without padding). */
ptr image_surface_from_rgba(val const &rgba, int width, int height)
{
    auto bytes = bytes_in(rgba);
    auto surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
    if (cairo_surface_status(surface) != CAIRO_STATUS_SUCCESS) {
        return ptr(surface);
    }
    cairo_surface_flush(surface);
    auto data = cairo_image_surface_get_data(surface);
    int stride = cairo_image_surface_get_stride(surface);
    for (int y = 0; y < height; y++) {
        auto row = reinterpret_cast<uint32_t *>(data + y * stride);
        for (int x = 0; x < width; x++) {
            size_t i = 4 * (size_t(y) * width + x);
            if (i + 3 >= bytes.size()) {
                row[x] = 0;
                continue;
            }
            uint32_t a = bytes[i + 3];
            auto pm = [a](uint32_t c) { return (c * a + 127) / 255; };
            row[x] = (a << 24) | (pm(bytes[i]) << 16) | (pm(bytes[i + 1]) << 8) | pm(bytes[i + 2]);
        }
    }
    cairo_surface_mark_dirty(surface);
    return ptr(surface);
}

struct ReadClosure {
    std::vector<unsigned char> const *data;
    size_t pos;
};

cairo_status_t read_callback(void *closure, unsigned char *data, unsigned int length)
{
    auto c = static_cast<ReadClosure *>(closure);
    if (c->pos + length > c->data->size()) {
        return CAIRO_STATUS_READ_ERROR;
    }
    std::copy_n(c->data->data() + c->pos, length, data);
    c->pos += length;
    return CAIRO_STATUS_SUCCESS;
}

ptr image_surface_from_png(val const &png)
{
    auto bytes = bytes_in(png);
    ReadClosure closure{&bytes, 0};
    return ptr(cairo_image_surface_create_from_png_stream(read_callback, &closure));
}

/** The pixels of an image surface: stride * height bytes (native-endian 32-bit ARGB or A8). */
val image_surface_get_data(ptr surface)
{
    auto s = P<cairo_surface_t>(surface);
    cairo_surface_flush(s);
    auto data = cairo_image_surface_get_data(s);
    if (!data) {
        return val::null();
    }
    return bytes_out(data, size_t(cairo_image_surface_get_stride(s)) * cairo_image_surface_get_height(s));
}

void image_surface_set_data(ptr surface, val const &bytes)
{
    auto s = P<cairo_surface_t>(surface);
    cairo_surface_flush(s);
    auto in = bytes_in(bytes);
    auto data = cairo_image_surface_get_data(s);
    size_t size = size_t(cairo_image_surface_get_stride(s)) * cairo_image_surface_get_height(s);
    if (data) {
        std::copy_n(in.data(), std::min(size, in.size()), data);
    }
    cairo_surface_mark_dirty(s);
}

val surface_write_to_png(ptr surface)
{
    std::vector<unsigned char> out;
    cairo_surface_write_to_png_stream(P<cairo_surface_t>(surface), write_callback, &out);
    return bytes_out(out.data(), out.size());
}

/** Attach the encoded image (for example JPEG data) for PDF and PS output, as Inkscape::Pixbuf does. */
void surface_set_mime_data(ptr surface, std::string const &mime_type, val const &bytes)
{
    auto data = new std::vector<unsigned char>(bytes_in(bytes));
    cairo_surface_set_mime_data(
        P<cairo_surface_t>(surface), mime_type.c_str(), data->data(), data->size(),
        [](void *d) { delete static_cast<std::vector<unsigned char> *>(d); }, data);
}

// --- Paths ---

/**
 * Append a path: ops has one code per segment (0 move to, 1 line to, 2 curve to, 3 close path),
 * coords the points of the segments (x, y pairs: 1 for move and line, 3 for curve).
 */
void append_path(ptr cr, val const &ops, val const &coords)
{
    auto o = emscripten::convertJSArrayToNumberVector<uint8_t>(ops);
    auto c = emscripten::convertJSArrayToNumberVector<double>(coords);
    size_t i = 0;
    for (auto op : o) {
        switch (op) {
            case 0:
                cairo_move_to(CR(cr), c[i], c[i + 1]);
                i += 2;
                break;
            case 1:
                cairo_line_to(CR(cr), c[i], c[i + 1]);
                i += 2;
                break;
            case 2:
                cairo_curve_to(CR(cr), c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5]);
                i += 6;
                break;
            default:
                cairo_close_path(CR(cr));
                break;
        }
    }
}

// --- Matrices: [xx, yx, xy, yy, x0, y0] (the order of Geom::Affine) ---

cairo_matrix_t matrix_in(val const &m)
{
    auto v = emscripten::convertJSArrayToNumberVector<double>(m);
    cairo_matrix_t matrix;
    cairo_matrix_init(&matrix, v[0], v[1], v[2], v[3], v[4], v[5]);
    return matrix;
}

val matrix_out(cairo_matrix_t const &m)
{
    auto result = val::array();
    for (double v : {m.xx, m.yx, m.xy, m.yy, m.x0, m.y0}) {
        result.call<void>("push", v);
    }
    return result;
}

val get_matrix(ptr cr)
{
    cairo_matrix_t m;
    cairo_get_matrix(CR(cr), &m);
    return matrix_out(m);
}

void set_matrix(ptr cr, val const &m)
{
    auto matrix = matrix_in(m);
    cairo_set_matrix(CR(cr), &matrix);
}

void transform(ptr cr, val const &m)
{
    auto matrix = matrix_in(m);
    cairo_transform(CR(cr), &matrix);
}

void pattern_set_matrix(ptr pattern, val const &m)
{
    auto matrix = matrix_in(m);
    cairo_pattern_set_matrix(P<cairo_pattern_t>(pattern), &matrix);
}

void set_font_matrix(ptr cr, val const &m)
{
    auto matrix = matrix_in(m);
    cairo_set_font_matrix(CR(cr), &matrix);
}

void set_dash(ptr cr, val const &dashes, double offset)
{
    auto d = emscripten::convertJSArrayToNumberVector<double>(dashes);
    cairo_set_dash(CR(cr), d.data(), int(d.size()), offset);
}

// --- Fonts ---

FT_Library ft_library()
{
    static FT_Library library = nullptr;
    if (!library) {
        FT_Init_FreeType(&library);
    }
    return library;
}

struct FontData {
    std::vector<unsigned char> bytes;
    FT_Face face = nullptr;
};

cairo_user_data_key_t font_data_key;

/** A cairo font face for a font file (face index in a collection); 0 if FreeType cannot read it. */
ptr ft_font_face_create(val const &bytes, int index)
{
    auto data = new FontData{bytes_in(bytes)};
    if (FT_New_Memory_Face(ft_library(), data->bytes.data(), FT_Long(data->bytes.size()), index, &data->face)) {
        delete data;
        return 0;
    }
    auto font_face = cairo_ft_font_face_create_for_ft_face(data->face, 0);
    cairo_font_face_set_user_data(font_face, &font_data_key, data, [](void *d) {
        auto data = static_cast<FontData *>(d);
        FT_Done_Face(data->face);
        delete data;
    });
    return ptr(font_face);
}

/** The glyph indices of the code points (0 where the font has no glyph). */
val ft_font_face_glyph_indices(ptr font_face, val const &codepoints)
{
    auto data = static_cast<FontData *>(cairo_font_face_get_user_data(P<cairo_font_face_t>(font_face), &font_data_key));
    auto result = val::array();
    for (auto c : emscripten::convertJSArrayToNumberVector<uint32_t>(codepoints)) {
        result.call<void>("push", data ? unsigned(FT_Get_Char_Index(data->face, c)) : 0u);
    }
    return result;
}

/** Glyphs as [index, x, y, index, x, y, ...]. */
std::vector<cairo_glyph_t> glyphs_in(val const &glyphs)
{
    auto v = emscripten::convertJSArrayToNumberVector<double>(glyphs);
    std::vector<cairo_glyph_t> result;
    for (size_t i = 0; i + 2 < v.size(); i += 3) {
        result.push_back({static_cast<unsigned long>(v[i]), v[i + 1], v[i + 2]});
    }
    return result;
}

void show_glyphs(ptr cr, val const &glyphs)
{
    auto g = glyphs_in(glyphs);
    cairo_show_glyphs(CR(cr), g.data(), int(g.size()));
}

void glyph_path(ptr cr, val const &glyphs)
{
    auto g = glyphs_in(glyphs);
    cairo_glyph_path(CR(cr), g.data(), int(g.size()));
}

}  // namespace

EMSCRIPTEN_BINDINGS(cairo)
{
    using namespace emscripten;
    // Surfaces
    function("pdfSurfaceCreate", &pdf_surface_create);
    function("psSurfaceCreate", &ps_surface_create);
    function("surfaceTakeOutput", &surface_take_output);
    function("surfaceDestroy", &surface_destroy);
    function("surfaceFinish", +[](ptr s) { cairo_surface_finish(P<cairo_surface_t>(s)); });
    function("surfaceStatus", +[](ptr s) { return int(cairo_surface_status(P<cairo_surface_t>(s))); });
    function("surfaceCreateSimilar", +[](ptr s, int content, int w, int h) {
        return ptr(cairo_surface_create_similar(P<cairo_surface_t>(s), cairo_content_t(content), w, h));
    });
    function("surfaceGetContent", +[](ptr s) { return int(cairo_surface_get_content(P<cairo_surface_t>(s))); });
    function("surfaceSetMimeData", &surface_set_mime_data);
    function("surfaceWriteToPng", &surface_write_to_png);
    function("pdfSurfaceRestrictToVersion", +[](ptr s, int v) {
        cairo_pdf_surface_restrict_to_version(P<cairo_surface_t>(s), cairo_pdf_version_t(v));
    });
    function("pdfSurfaceSetSize", +[](ptr s, double w, double h) { cairo_pdf_surface_set_size(P<cairo_surface_t>(s), w, h); });
    function("pdfSurfaceSetPageLabel", +[](ptr s, std::string const &label) {
        cairo_pdf_surface_set_page_label(P<cairo_surface_t>(s), label.c_str());
    });
    function("pdfSurfaceSetMetadata", +[](ptr s, int key, std::string const &value) {
        cairo_pdf_surface_set_metadata(P<cairo_surface_t>(s), cairo_pdf_metadata_t(key), value.c_str());
    });
    function("psSurfaceRestrictToLevel", +[](ptr s, int level) {
        cairo_ps_surface_restrict_to_level(P<cairo_surface_t>(s), cairo_ps_level_t(level));
    });
    function("psSurfaceSetEps", +[](ptr s, bool eps) { cairo_ps_surface_set_eps(P<cairo_surface_t>(s), eps); });
    function("psSurfaceSetSize", +[](ptr s, double w, double h) { cairo_ps_surface_set_size(P<cairo_surface_t>(s), w, h); });
    function("psSurfaceDscComment", +[](ptr s, std::string const &comment) {
        cairo_ps_surface_dsc_comment(P<cairo_surface_t>(s), comment.c_str());
    });
    function("imageSurfaceCreate", +[](int format, int w, int h) {
        return ptr(cairo_image_surface_create(cairo_format_t(format), w, h));
    });
    function("imageSurfaceFromRgba", &image_surface_from_rgba);
    function("imageSurfaceFromPng", &image_surface_from_png);
    function("imageSurfaceGetData", &image_surface_get_data);
    function("imageSurfaceSetData", &image_surface_set_data);
    function("imageSurfaceGetWidth", +[](ptr s) { return cairo_image_surface_get_width(P<cairo_surface_t>(s)); });
    function("imageSurfaceGetHeight", +[](ptr s) { return cairo_image_surface_get_height(P<cairo_surface_t>(s)); });
    function("imageSurfaceGetStride", +[](ptr s) { return cairo_image_surface_get_stride(P<cairo_surface_t>(s)); });

    // Context
    function("create", +[](ptr s) { return ptr(cairo_create(P<cairo_surface_t>(s))); });
    function("destroy", +[](ptr cr) { cairo_destroy(CR(cr)); });
    function("status", +[](ptr cr) { return int(cairo_status(CR(cr))); });
    function("statusToString", +[](int status) { return std::string(cairo_status_to_string(cairo_status_t(status))); });
    function("getTarget", +[](ptr cr) { return ptr(cairo_get_target(CR(cr))); });
    function("save", +[](ptr cr) { cairo_save(CR(cr)); });
    function("restore", +[](ptr cr) { cairo_restore(CR(cr)); });
    function("pushGroup", +[](ptr cr) { cairo_push_group(CR(cr)); });
    function("popGroupToSource", +[](ptr cr) { cairo_pop_group_to_source(CR(cr)); });
    function("showPage", +[](ptr cr) { cairo_show_page(CR(cr)); });
    function("setOperator", +[](ptr cr, int op) { cairo_set_operator(CR(cr), cairo_operator_t(op)); });
    function("paint", +[](ptr cr) { cairo_paint(CR(cr)); });
    function("paintWithAlpha", +[](ptr cr, double a) { cairo_paint_with_alpha(CR(cr), a); });
    function("maskSurface", +[](ptr cr, ptr s, double x, double y) { cairo_mask_surface(CR(cr), P<cairo_surface_t>(s), x, y); });
    function("clip", +[](ptr cr) { cairo_clip(CR(cr)); });
    function("newPath", +[](ptr cr) { cairo_new_path(CR(cr)); });
    function("rectangle", +[](ptr cr, double x, double y, double w, double h) { cairo_rectangle(CR(cr), x, y, w, h); });
    function("appendPath", &append_path);
    function("fill", +[](ptr cr) { cairo_fill(CR(cr)); });
    function("fillPreserve", +[](ptr cr) { cairo_fill_preserve(CR(cr)); });
    function("stroke", +[](ptr cr) { cairo_stroke(CR(cr)); });
    function("strokePreserve", +[](ptr cr) { cairo_stroke_preserve(CR(cr)); });
    function("setFillRule", +[](ptr cr, int rule) { cairo_set_fill_rule(CR(cr), cairo_fill_rule_t(rule)); });
    function("setSourceRgba", +[](ptr cr, double r, double g, double b, double a) { cairo_set_source_rgba(CR(cr), r, g, b, a); });
    function("setSource", +[](ptr cr, ptr pattern) { cairo_set_source(CR(cr), P<cairo_pattern_t>(pattern)); });
    function("setSourceSurface", +[](ptr cr, ptr s, double x, double y) {
        cairo_set_source_surface(CR(cr), P<cairo_surface_t>(s), x, y);
    });
    function("getSource", +[](ptr cr) { return ptr(cairo_get_source(CR(cr))); });
    function("setDash", &set_dash);
    function("setLineWidth", +[](ptr cr, double w) { cairo_set_line_width(CR(cr), w); });
    function("setHairline", +[](ptr cr, bool on) { cairo_set_hairline(CR(cr), on); });
    function("setLineJoin", +[](ptr cr, int join) { cairo_set_line_join(CR(cr), cairo_line_join_t(join)); });
    function("setLineCap", +[](ptr cr, int cap) { cairo_set_line_cap(CR(cr), cairo_line_cap_t(cap)); });
    function("setMiterLimit", +[](ptr cr, double limit) { cairo_set_miter_limit(CR(cr), limit); });
    function("getMatrix", &get_matrix);
    function("setMatrix", &set_matrix);
    function("transform", &transform);
    function("identityMatrix", +[](ptr cr) { cairo_identity_matrix(CR(cr)); });
    function("scale", +[](ptr cr, double sx, double sy) { cairo_scale(CR(cr), sx, sy); });
    function("tagBegin", +[](ptr cr, std::string const &name, std::string const &attributes) {
        cairo_tag_begin(CR(cr), name.c_str(), attributes.c_str());
    });
    function("tagEnd", +[](ptr cr, std::string const &name) { cairo_tag_end(CR(cr), name.c_str()); });

    // Patterns
    function("patternCreateLinear", +[](double x0, double y0, double x1, double y1) {
        return ptr(cairo_pattern_create_linear(x0, y0, x1, y1));
    });
    function("patternCreateRadial", +[](double cx0, double cy0, double r0, double cx1, double cy1, double r1) {
        return ptr(cairo_pattern_create_radial(cx0, cy0, r0, cx1, cy1, r1));
    });
    function("patternCreateForSurface", +[](ptr s) { return ptr(cairo_pattern_create_for_surface(P<cairo_surface_t>(s))); });
    function("patternAddColorStopRgba", +[](ptr p, double offset, double r, double g, double b, double a) {
        cairo_pattern_add_color_stop_rgba(P<cairo_pattern_t>(p), offset, r, g, b, a);
    });
    function("patternSetExtend", +[](ptr p, int extend) { cairo_pattern_set_extend(P<cairo_pattern_t>(p), cairo_extend_t(extend)); });
    function("patternSetFilter", +[](ptr p, int filter) { cairo_pattern_set_filter(P<cairo_pattern_t>(p), cairo_filter_t(filter)); });
    function("patternSetMatrix", &pattern_set_matrix);
    function("patternDestroy", +[](ptr p) { cairo_pattern_destroy(P<cairo_pattern_t>(p)); });

    // Fonts
    function("ftFontFaceCreate", &ft_font_face_create);
    function("ftFontFaceGlyphIndices", &ft_font_face_glyph_indices);
    function("fontFaceDestroy", +[](ptr f) { cairo_font_face_destroy(P<cairo_font_face_t>(f)); });
    function("setFontFace", +[](ptr cr, ptr f) { cairo_set_font_face(CR(cr), P<cairo_font_face_t>(f)); });
    function("setFontMatrix", &set_font_matrix);
    function("showGlyphs", &show_glyphs);
    function("glyphPath", &glyph_path);
}
