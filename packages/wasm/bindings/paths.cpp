// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API of geom-module.wasm: the livarot parts of the path menu. Geometry in and out as SVG
// path data, like geom.cpp.
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/path-sink.h>
#include <2geom/pathvector.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include <libvpsc/rectangle.h>
#include "helper/geom.h"
#include "livarot/Path.h"
#include "livarot/Shape.h"

// Upstream: src/path/path-offset.cpp sp_selected_path_do_offset(), the livarot part. `d` is in the
// coordinates in which `width` (already divided by the scale, at least MIN_OFFSET) applies.
// width > 0 outsets, width < 0 insets. join is a livarot JoinType, miter is already multiplied by
// the width; fill_rule is a FillRule of livarot (fill_nonZero or fill_oddEven).
std::string offset_shape(std::string const &d, double width, int join, double miter, int fill_rule)
{
    Geom::PathVector const pathv = pathv_to_linear_and_cubic_beziers(Geom::parse_svg_path(d.c_str()));
    Path orig;
    orig.LoadPathVector(pathv);

    Path res;
    res.SetBackData(false);

    Shape theShape;
    Shape theRes;

    orig.ConvertWithBackData(0.03);
    orig.Fill(&theShape, 0);
    theRes.ConvertToShape(&theShape, static_cast<FillRule>(fill_rule));

    // methode par makeoffset
    theShape.MakeOffset(&theRes, width, static_cast<JoinType>(join), miter);
    theRes.ConvertToShape(&theShape, fill_positive);

    res.Reset();
    theRes.ConvertToForme(&res);

    res.ConvertEvenLines(0.1);
    res.Simplify(0.1);
    if (res.descr_cmd.size() <= 1) {
        return "";
    }
    return res.svg_dump_path();
}

// Upstream: src/path/path-offset.cpp sp_selected_path_create_offset_object(): the contour of the
// filled path without self-intersections (the `inkscape:original` of an offset), by the fill rule.
std::string normalize_shape(std::string const &d, int fill_rule)
{
    Geom::PathVector const pathv = Geom::parse_svg_path(d.c_str());
    Path orig;
    orig.LoadPathVector(pathv);

    Path res;
    res.SetBackData(false);

    Shape theShape;
    Shape theRes;

    orig.ConvertWithBackData(1.0);
    orig.Fill(&theShape, 0);
    theRes.ConvertToShape(&theShape, static_cast<FillRule>(fill_rule));

    Path *paths[] = {&orig};
    theRes.ConvertToForme(&res, 1, paths);
    if (res.descr_cmd.size() <= 1) {
        return "";
    }
    return res.svg_dump_path();
}

// Upstream: src/path/path-outline.cpp item_find_paths() without bbox_only: the outline of the
// stroke of `d` as an intersection free path (dashes, join, cap and miter are the style of the
// item). `scale` is the descrim() of the item transform.
std::string stroke_to_path(std::string const &d, double width, int join, int butt, double miter,
                           emscripten::val const &dashes_js, double dash_offset, double scale)
{
    auto const dashes = emscripten::convertJSArrayToNumberVector<double>(dashes_js);
    Geom::PathVector const pathv = pathv_to_linear_and_cubic_beziers(Geom::parse_svg_path(d.c_str()));
    Path origin;
    Path offset;
    origin.LoadPathVector(pathv);
    offset.SetBackData(false);

    if (!dashes.empty()) {
        // We have dashes!
        origin.ConvertWithBackData(0.005); // Approximate by polyline
        origin.DashPolyline(dashes, dash_offset, scale, 0);
        auto bounds = Geom::bounds_fast(pathv);
        if (bounds) {
            double size = Geom::L2(bounds->dimensions());
            origin.Simplify(size * 0.000005); // Polylines to Beziers
        }
    }

    // Finally do offset!
    origin.Outline(&offset, 0.5 * width, static_cast<JoinType>(join), static_cast<ButtType>(butt), 0.5 * miter);

    // Clean-up shape
    offset.ConvertWithBackData(1.0); // Approximate by polyline

    Shape theShape;
    offset.Fill(&theShape, 0); // Convert polyline to shape, step 1.

    Shape theOffset;
    theOffset.ConvertToShape(&theShape, fill_positive); // Create an intersection free polygon, step 2.
    Path *offsets[1] = {&offset};
    theOffset.ConvertToForme(&origin, 1, offsets); // Turn shape into contour (stored in origin).

    return Geom::write_svg_path(origin.MakePathVector());
}

// Upstream: src/object/sp-offset.cpp SPOffset::set_shape(), the livarot part of the default
// ("fast") method: the offset of the original path by `rad` (not near 0), with round joins.
// `size` is the diagonal of the bounding box of the object divided by the scale of its transform
// (0: no coalescing); the result is coalesced with size * 0.001.
std::string offset_original(std::string const &d, double rad, double size)
{
    Geom::PathVector const pv = Geom::parse_svg_path(d.c_str());
    Path orig;
    orig.LoadPathVector(pv);

    Shape theShape;
    Shape theRes;
    Path *originaux[1];
    Path res;
    res.SetBackData(false);

    // and now: offset
    float o_width;
    if (rad >= 0) {
        o_width = rad;
        orig.OutsideOutline(&res, o_width, join_round, butt_straight, 20.0);
    } else {
        o_width = -rad;
        orig.OutsideOutline(&res, -o_width, join_round, butt_straight, 20.0);
    }

    if (o_width >= 1.0) {
        res.ConvertWithBackData(1.0);
    } else {
        res.ConvertWithBackData(o_width);
    }
    res.Fill(&theShape, 0);
    theRes.ConvertToShape(&theShape, fill_positive);
    originaux[0] = &res;

    theRes.ConvertToForme(&orig, 1, originaux);

    if (size > 0) {
        orig.Coalesce(size * 0.001);
    }
    return orig.svg_dump_path();
}

// Upstream: src/object/algorithms/removeoverlap.cpp removeoverlap(), the vpsc part. `boxes` is
// [minx, maxx, miny, maxy, ...] per box (already grown by half the gaps); the result is the
// centre [x, y, ...] of each box after the overlaps are removed.
emscripten::val remove_overlaps(emscripten::val const &boxes_js)
{
    auto const boxes = emscripten::convertJSArrayToNumberVector<double>(boxes_js);
    std::vector<vpsc::Rectangle *> rs;
    for (size_t i = 0; i + 3 < boxes.size(); i += 4) {
        rs.push_back(new vpsc::Rectangle(boxes[i], boxes[i + 1], boxes[i + 2], boxes[i + 3]));
    }
    if (!rs.empty()) {
        removeoverlaps(rs);
    }
    auto out = emscripten::val::array();
    for (auto *r : rs) {
        out.call<void>("push", r->getCentreX());
        out.call<void>("push", r->getCentreY());
        delete r;
    }
    return out;
}

EMSCRIPTEN_BINDINGS(paths)
{
    emscripten::function("removeOverlaps", &remove_overlaps);
    emscripten::function("normalizeShape", &normalize_shape);
    emscripten::function("offsetShape", &offset_shape);
    emscripten::function("offsetOriginal", &offset_original);
    emscripten::function("strokeToPath", &stroke_to_path);
}
