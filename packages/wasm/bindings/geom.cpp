// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API of geom-module.wasm. Keep it small: one function per upstream
// operation, geometry in and out as SVG path data. src/index.ts wraps it with types.
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/affine.h>
#include <2geom/path-sink.h>
#include <2geom/pathvector.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include "helper/geom-pathstroke.h"
#include "path/path-boolop.h"

// Upstream: src/path/path-boolop.cpp sp_pathvector_boolop()
std::string boolop(std::string const &a, std::string const &b, int op, int fill_a, int fill_b)
{
    auto result = sp_pathvector_boolop(Geom::parse_svg_path(a.c_str()), Geom::parse_svg_path(b.c_str()),
                                       static_cast<BooleanOp>(op), static_cast<FillRule>(fill_a),
                                       static_cast<FillRule>(fill_b));
    return Geom::write_svg_path(result);
}

static emscripten::val write_paths(std::vector<Geom::PathVector> const &list)
{
    auto out = emscripten::val::array();
    for (auto const &pv : list) {
        out.call<void>("push", Geom::write_svg_path(pv));
    }
    return out;
}

// Upstream: src/path/path-boolop.cpp pathvector_cut(). The pieces of `pathv` cut by `lines`,
// each with its holes (Path > Division).
emscripten::val cut_path(std::string const &pathv, std::string const &lines)
{
    return write_paths(pathvector_cut(Geom::parse_svg_path(pathv.c_str()), Geom::parse_svg_path(lines.c_str())));
}

// Upstream: src/helper/geom-pathstroke.cpp split_non_intersecting_paths() (Path > Break Apart).
emscripten::val split_non_intersecting(std::string const &d, int fill_rule)
{
    return write_paths(Inkscape::split_non_intersecting_paths(Geom::parse_svg_path(d.c_str()),
                                                              static_cast<FillRule>(fill_rule)));
}

// Parse and write path data with fixed precision, absolute commands and no shorthands.
std::string normalize_path(std::string const &d, int precision)
{
    return Geom::write_svg_path(Geom::parse_svg_path(d.c_str()), precision, false, false);
}

// The functions below are reference implementations for the TypeScript port in packages/geom
// (see packages/geom/src/*.parity.test.ts).

static Geom::Affine affine_from(double a, double b, double c, double d, double e, double f)
{
    return Geom::Affine(a, b, c, d, e, f);
}

/// Bounds of the transformed path as [left, top, right, bottom], or [] for an empty path.
emscripten::val path_bounds(std::string const &d, bool exact, double a, double b, double c, double dd,
                            double e, double f)
{
    auto pv = Geom::parse_svg_path(d.c_str()) * affine_from(a, b, c, dd, e, f);
    Geom::OptRect r = exact ? pv.boundsExact() : pv.boundsFast();
    auto out = emscripten::val::array();
    if (r) {
        out.call<void>("push", r->left());
        out.call<void>("push", r->top());
        out.call<void>("push", r->right());
        out.call<void>("push", r->bottom());
    }
    return out;
}

std::string transform_path(std::string const &d, double a, double b, double c, double dd, double e, double f)
{
    return Geom::write_svg_path(Geom::parse_svg_path(d.c_str()) * affine_from(a, b, c, dd, e, f));
}

std::string reverse_path(std::string const &d)
{
    return Geom::write_svg_path(Geom::parse_svg_path(d.c_str()).reversed());
}

std::string write_path(std::string const &d, int precision, bool optimize, bool shorthands)
{
    return Geom::write_svg_path(Geom::parse_svg_path(d.c_str()), precision, optimize, shorthands);
}

/// Same as Inkscape's sp_svg_read_pathv() (src/svg/svg-path.cpp): on a parse error, keeps the
/// paths read so far. Returns { ok, d }.
emscripten::val read_path(std::string const &d, double z_snap_threshold)
{
    Geom::PathVector pv;
    Geom::PathBuilder builder(pv);
    Geom::SVGPathParser parser(builder);
    parser.setZSnapThreshold(z_snap_threshold);
    bool ok = true;
    try {
        parser.parse(d.c_str());
    } catch (Geom::SVGPathParseError &) {
        builder.flush();
        ok = false;
    }
    auto out = emscripten::val::object();
    out.set("ok", ok);
    out.set("d", Geom::write_svg_path(pv));
    return out;
}

EMSCRIPTEN_BINDINGS(geom)
{
    emscripten::function("boolop", &boolop);
    emscripten::function("cutPath", &cut_path);
    emscripten::function("splitNonIntersectingPaths", &split_non_intersecting);
    emscripten::function("normalizePath", &normalize_path);
    emscripten::function("pathBounds", &path_bounds);
    emscripten::function("transformPath", &transform_path);
    emscripten::function("reversePath", &reverse_path);
    emscripten::function("writePath", &write_path);
    emscripten::function("readPath", &read_path);
}
