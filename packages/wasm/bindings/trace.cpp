// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for Trace Bitmap and the paint bucket: potrace, the trace filters and color
// quantization of src/trace/, and the livarot part of the paint bucket. Images go in and out as
// typed arrays (row by row, no padding); src/index.ts wraps it with types.
#include <cstdint>
#include <vector>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/svg-path-parser.h>
#include <potracelib.h>
#include "livarot/Path.h"
#include "livarot/Shape.h"
#include "trace/filterset.h"
#include "trace/imagemap.h"
#include "trace/potrace/bitmap.h"
#include "trace/quantize.h"

using emscripten::val;
using Inkscape::Trace::GrayMap;
using Inkscape::Trace::RGB;
using Inkscape::Trace::RgbMap;

namespace {

template <typename T>
val copy_out(std::vector<T> const &v)
{
    return val(emscripten::typed_memory_view(v.size(), v.data())).call<val>("slice");
}

RgbMap rgb_map_in(val const &rgb, int width, int height)
{
    auto bytes = emscripten::convertJSArrayToNumberVector<uint8_t>(rgb);
    auto map = RgbMap(width, height);
    for (int i = 0; i < width * height; i++) {
        map.pixels[i] = RGB{bytes[3 * i], bytes[3 * i + 1], bytes[3 * i + 2]};
    }
    return map;
}

val rgb_map_out(RgbMap const &map)
{
    std::vector<uint8_t> bytes(3 * map.pixels.size());
    for (size_t i = 0; i < map.pixels.size(); i++) {
        bytes[3 * i] = map.pixels[i].r;
        bytes[3 * i + 1] = map.pixels[i].g;
        bytes[3 * i + 2] = map.pixels[i].b;
    }
    return copy_out(bytes);
}

GrayMap gray_map_in(val const &gray, int width, int height)
{
    auto values = emscripten::convertJSArrayToNumberVector<uint32_t>(gray);
    auto map = GrayMap(width, height);
    for (int i = 0; i < width * height; i++) {
        map.pixels[i] = values[i];
    }
    return map;
}

val gray_map_out(GrayMap const &map)
{
    return copy_out(std::vector<uint32_t>(map.pixels.begin(), map.pixels.end()));
}

/// The potrace path tree (upstream: the sibling and childlist links that
/// PotraceTracingEngine::writePaths() walks): [{ tags, c, children }], c has 6 numbers per segment.
val write_tree(potrace_path_t const *paths)
{
    auto out = val::array();
    for (auto path = paths; path; path = path->sibling) {
        auto const &curve = path->curve;
        auto tags = val::array();
        auto c = val::array();
        for (int i = 0; i < curve.n; i++) {
            tags.call<void>("push", curve.tag[i]);
            for (int k = 0; k < 3; k++) {
                c.call<void>("push", curve.c[i][k].x);
                c.call<void>("push", curve.c[i][k].y);
            }
        }
        auto node = val::object();
        node.set("tags", tags);
        node.set("c", c);
        node.set("children", write_tree(path->childlist));
        out.call<void>("push", node);
    }
    return out;
}

} // namespace

// Upstream: src/trace/potrace/inkscape-potrace.cpp grayMapToPath(), the call to potrace.
// `bits` has one byte per pixel, non-zero for black. Returns the path tree, or null on failure.
val potrace_trace_bitmap(val const &bits, int width, int height, int turdsize, double alphamax, int opticurve,
                         double opttolerance)
{
    auto data = emscripten::convertJSArrayToNumberVector<uint8_t>(bits);
    auto bm = bm_new(width, height);
    if (!bm) {
        return val::null();
    }
    bm_clear(bm, 0);
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            BM_UPUT(bm, x, y, data[y * width + x] ? 1 : 0);
        }
    }
    auto params = potrace_param_default();
    params->turdsize = turdsize;
    params->alphamax = alphamax;
    params->opticurve = opticurve;
    params->opttolerance = opttolerance;
    auto state = potrace_trace(params, bm);
    bm_free(bm);
    potrace_param_free(params);
    if (!state || state->status != POTRACE_STATUS_OK) {
        if (state) {
            potrace_state_free(state);
        }
        return val::null();
    }
    auto out = write_tree(state->plist);
    potrace_state_free(state);
    return out;
}

// Upstream: src/trace/quantize.cpp rgbMapQuantize(). Returns { pixels, clut, nrColors };
// clut has 3 numbers per color.
val rgb_map_quantize(val const &rgb, int width, int height, int ncolor)
{
    auto imap = Inkscape::Trace::rgbMapQuantize(rgb_map_in(rgb, width, height), ncolor);
    auto clut = val::array();
    for (int i = 0; i < imap.nrColors; i++) {
        clut.call<void>("push", imap.clut[i].r);
        clut.call<void>("push", imap.clut[i].g);
        clut.call<void>("push", imap.clut[i].b);
    }
    auto out = val::object();
    out.set("pixels", copy_out(imap.pixels));
    out.set("clut", clut);
    out.set("nrColors", imap.nrColors);
    return out;
}

// Upstream: src/trace/filterset.cpp rgbMapGaussian().
val rgb_map_gaussian(val const &rgb, int width, int height)
{
    return rgb_map_out(Inkscape::Trace::rgbMapGaussian(rgb_map_in(rgb, width, height)));
}

// Upstream: src/trace/filterset.cpp grayMapGaussian().
val gray_map_gaussian(val const &gray, int width, int height)
{
    return gray_map_out(Inkscape::Trace::grayMapGaussian(gray_map_in(gray, width, height)));
}

// Upstream: src/trace/filterset.cpp grayMapCanny().
val gray_map_canny(val const &gray, int width, int height, double low, double high)
{
    return gray_map_out(Inkscape::Trace::grayMapCanny(gray_map_in(gray, width, height), low, high));
}

// Upstream: src/trace/filterset.cpp quantizeBand().
val quantize_band(val const &rgb, int width, int height, int ncolor)
{
    return gray_map_out(Inkscape::Trace::quantizeBand(rgb_map_in(rgb, width, height), ncolor));
}

// Upstream: src/ui/tools/flood-tool.cpp do_trace(), the livarot part: the path data of the traced
// path, inset or outset by `offset` (screen px) when not 0. "" when the offset leaves nothing.
std::string flood_path_data(std::string const &d, double offset)
{
    Path path;
    path.LoadPathVector(Geom::parse_svg_path(d.c_str()));

    if (offset == 0) {
        return path.svg_dump_path();
    }

    Shape path_shape;
    path.ConvertWithBackData(0.03);
    path.Fill(&path_shape, 0);

    Shape expanded_path_shape;
    expanded_path_shape.ConvertToShape(&path_shape, fill_nonZero);
    path_shape.MakeOffset(&expanded_path_shape, offset, join_round, 4);
    expanded_path_shape.ConvertToShape(&path_shape, fill_positive);

    Path expanded_path;
    expanded_path_shape.ConvertToForme(&expanded_path);
    expanded_path.ConvertEvenLines(1.0);
    expanded_path.Simplify(1.0);

    return expanded_path.svg_dump_path();
}

EMSCRIPTEN_BINDINGS(trace)
{
    emscripten::function("potraceTrace", &potrace_trace_bitmap);
    emscripten::function("rgbMapQuantize", &rgb_map_quantize);
    emscripten::function("rgbMapGaussian", &rgb_map_gaussian);
    emscripten::function("grayMapGaussian", &gray_map_gaussian);
    emscripten::function("grayMapCanny", &gray_map_canny);
    emscripten::function("quantizeBand", &quantize_band);
    emscripten::function("floodPathData", &flood_path_data);
}
