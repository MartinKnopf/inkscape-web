// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API of geom-module.wasm. Keep it small: one function per upstream
// operation, geometry in and out as SVG path data. src/index.ts wraps it with types.
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/affine.h>
#include <2geom/path-intersection.h>
#include <2geom/path-sink.h>
#include <2geom/pathvector.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include <2geom/sbasis-geometric.h>
#include <2geom/sbasis-to-bezier.h>
#include "helper/geom.h"
#include "helper/geom-nodesatellite.h"
#include "helper/geom-pathstroke.h"
#include "livarot/Path.h"
#include "livarot/Shape.h"
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

// Upstream: src/helper/geom.cpp pathvs_have_nonempty_overlap(), used by SPItem::collidesWith().
bool paths_overlap(std::string const &a, std::string const &b)
{
    return pathvs_have_nonempty_overlap(Geom::parse_svg_path(a.c_str()), Geom::parse_svg_path(b.c_str()));
}

// Upstream: src/ui/tools/tweak-tool.cpp sp_tweak_dilate_recursive(), the livarot part of the path
// modes (push, shrink/grow, attract/repel, roughen). `d` is in item coordinates, (cx, cy) and the
// vector in document coordinates, i2doc is (a b c dd e f). Returns { changed, d }: changed is false
// when Shape::MakeTweak() left the shape as it was; d is "" when the result has no path.
emscripten::val tweak_path(std::string const &d, int mode, double power, int fill_rule, double cx, double cy,
                           double vx, double vy, double radius, double a, double b, double c, double dd, double e,
                           double f, double fidelity, double force, double zoom)
{
    auto out = emscripten::val::object();
    out.set("changed", false);
    out.set("d", std::string());

    Path orig;
    orig.LoadPathVector(Geom::parse_svg_path(d.c_str()));
    Path res;
    res.SetBackData(false);
    Shape theShape;
    Shape theRes;
    Geom::Affine i2doc(a, b, c, dd, e, f);

    orig.ConvertWithBackData((0.08 - (0.07 * fidelity)) / i2doc.descrim()); // default 0.059
    orig.Fill(&theShape, 0);
    theRes.ConvertToShape(&theShape, static_cast<FillRule>(fill_rule));

    if (theShape.MakeTweak(mode, &theRes, power, join_straight, 4.0, true, Geom::Point(cx, cy), Geom::Point(vx, vy),
                           radius, &i2doc) != 0) {
        return out; // 0 means the shape was actually changed
    }
    out.set("changed", true);

    theRes.ConvertToShape(&theShape, fill_positive);
    res.Reset();
    theRes.ConvertToForme(&res);

    double th_max = (0.6 - 0.59 * sqrt(fidelity)) / i2doc.descrim();
    double threshold = std::max(th_max, th_max * force);
    res.ConvertEvenLines(threshold);
    res.Simplify(threshold / zoom);

    if (res.descr_cmd.size() > 1) {
        out.set("d", res.svg_dump_path());
    }
    return out;
}

// Parse and write path data with fixed precision, absolute commands and no shorthands.
std::string normalize_path(std::string const &d, int precision)
{
    return Geom::write_svg_path(Geom::parse_svg_path(d.c_str()), precision, false, false);
}

// Upstream: src/path/path-boolop.cpp flatten(): the path without self-intersections, with the fill rule.
std::string flatten_path(std::string const &d, int fill_rule)
{
    auto pv = Geom::parse_svg_path(d.c_str());
    flatten(pv, static_cast<FillRule>(fill_rule));
    return Geom::write_svg_path(pv);
}

// Geom::crossings(Path, Path) of the first path of `a` and of `b`: [ta, tb, ta, tb, ...].
emscripten::val path_crossings(std::string const &a, std::string const &b)
{
    auto out = emscripten::val::array();
    auto pa = Geom::parse_svg_path(a.c_str());
    auto pb = Geom::parse_svg_path(b.c_str());
    if (pa.empty() || pb.empty()) {
        return out;
    }
    for (auto const &c : Geom::crossings(pa[0], pb[0])) {
        out.call<void>("push", c.ta);
        out.call<void>("push", c.tb);
    }
    return out;
}

// Upstream: src/live_effects/lpe-simplify.cpp LPESimplify::doEffect(), the livarot part:
// `threshold` is already scaled by the item size.
std::string simplify_path(std::string const &d, double threshold, int steps, bool just_coalesce)
{
    Geom::PathVector const original_pathv = pathv_to_linear_and_cubic_beziers(Geom::parse_svg_path(d.c_str()));
    Path pathliv;
    pathliv.LoadPathVector(original_pathv);
    for (int i = 0; i < steps; ++i) {
        if (just_coalesce) {
            pathliv.Coalesce(threshold);
        } else {
            pathliv.ConvertEvenLines(threshold);
            pathliv.Simplify(threshold);
        }
    }
    return Geom::write_svg_path(pathliv.MakePathVector());
}

// Upstream: src/path/path-outline.cpp item_find_paths() with bbox_only: the livarot outline of the
// stroke (no dashes). join and butt are livarot JoinType and ButtType.
std::string stroke_outline(std::string const &d, double width, int join, int butt, double miter)
{
    Geom::PathVector const pathv = pathv_to_linear_and_cubic_beziers(Geom::parse_svg_path(d.c_str()));
    Path origin;
    Path offset;
    origin.LoadPathVector(pathv);
    offset.SetBackData(false);
    origin.Outline(&offset, 0.5 * width, static_cast<JoinType>(join), static_cast<ButtType>(butt), 0.5 * miter);
    return Geom::write_svg_path(offset.MakePathVector());
}

// Upstream: src/helper/geom-pathstroke.cpp do_offset() (Offset LPE). Returns { d, helper, mix }.
emscripten::val offset_path(std::string const &d, double to_offset, double tolerance, double miter_limit,
                            int fill_rule, int join, double px, double py)
{
    Geom::PathVector helper_path;
    Geom::PathVector mix_pathv_all;
    auto result = Inkscape::do_offset(Geom::parse_svg_path(d.c_str()), to_offset, tolerance, miter_limit,
                                      static_cast<FillRule>(fill_rule), static_cast<Inkscape::LineJoinType>(join),
                                      Geom::Point(px, py), helper_path, mix_pathv_all);
    auto out = emscripten::val::object();
    out.set("d", Geom::write_svg_path(result));
    out.set("helper", Geom::write_svg_path(helper_path));
    out.set("mix", Geom::write_svg_path(mix_pathv_all));
    return out;
}

// Upstream: src/live_effects/lpe-bendpath.cpp LPEBendPath::doEffect_pwd2(), called as
// Effect::doEffect_path() does with concatenate_before_pwd2 (the 2geom part of the Bend LPE).
// bbox_* is the original bbox of the item, the parameters are those of the effect.
std::string bend_path(std::string const &d, std::string const &bend, double bbox_x0, double bbox_x1,
                      double bbox_y0, double bbox_y1, double prop_scale, bool scale_y_rel, bool vertical,
                      bool version_1_5)
{
    using namespace Geom;
    PathVector const path_in = parse_svg_path(d.c_str());
    Piecewise<D2<SBasis>> pwd2_in;
    for (auto const &i : path_in) {
        pwd2_in.concat(i.toPwSb());
    }
    Piecewise<D2<SBasis>> uskeleton = arc_length_parametrization(paths_to_pw(parse_svg_path(bend.c_str())), 2, .1);
    uskeleton = remove_short_cuts(uskeleton, .01);
    Piecewise<D2<SBasis>> n = rot90(derivative(uskeleton));
    n = force_continuity(remove_short_cuts(n, .01));
    if (uskeleton.empty()) {
        return d;
    }
    Interval boundingbox_X(bbox_x0, bbox_x1);
    Interval boundingbox_Y(bbox_y0, bbox_y1);
    D2<Piecewise<SBasis>> patternd2 = make_cuts_independent(pwd2_in);
    Piecewise<SBasis> x = vertical ? Piecewise<SBasis>(patternd2[1]) : Piecewise<SBasis>(patternd2[0]);
    Piecewise<SBasis> y = vertical ? Piecewise<SBasis>(patternd2[0]) : Piecewise<SBasis>(patternd2[1]);
    Interval bboxHorizontal = vertical ? boundingbox_Y : boundingbox_X;
    Interval bboxVertical = vertical ? boundingbox_X : boundingbox_Y;
    if (version_1_5) {
        x -= bboxHorizontal.min();
    } else {
        //+0.1 in x fix bug #1658855
        x -= bboxHorizontal.min() + 0.1;
    }
    y -= bboxVertical.middle();
    double scaling = uskeleton.cuts.back() / bboxHorizontal.extent();
    if (scaling != 1.0) {
        x *= scaling;
    }
    if (scale_y_rel) {
        y *= (scaling * prop_scale);
    } else {
        if (prop_scale != 1.0) y *= prop_scale;
    }
    Piecewise<D2<SBasis>> output = compose(uskeleton, x) + y * compose(n, x);
    return write_svg_path(path_from_piecewise(output, 0.01 /* LPE_CONVERSION_TOLERANCE */));
}

static Geom::Curve const &first_curve(Geom::PathVector const &pv)
{
    return pv.at(0).at(0);
}

// Upstream: src/helper/geom-nodesatellite.cpp timeAtArcLength(): the time on the first curve of `d`
// at arc length A.
double nodesat_time_at_arc_length(std::string const &d, double a)
{
    return timeAtArcLength(a, first_curve(Geom::parse_svg_path(d.c_str())));
}

// Upstream: src/helper/geom-nodesatellite.cpp arcLengthAt(): the arc length of the first curve of `d`
// at time A.
double nodesat_arc_length_at(std::string const &d, double a)
{
    return arcLengthAt(a, first_curve(Geom::parse_svg_path(d.c_str())));
}

// Upstream: NodeSatellite::radToLen(): the knot distance on curve_out of a fillet with radius A.
double nodesat_rad_to_len(double a, std::string const &curve_in, std::string const &curve_out)
{
    NodeSatellite s;
    return s.radToLen(a, first_curve(Geom::parse_svg_path(curve_in.c_str())),
                      first_curve(Geom::parse_svg_path(curve_out.c_str())));
}

// Upstream: NodeSatellite::lenToRad(): the radius of a fillet with knot distance A.
double nodesat_len_to_rad(double a, std::string const &curve_in, std::string const &curve_out)
{
    NodeSatellite s;
    return s.lenToRad(a, first_curve(Geom::parse_svg_path(curve_in.c_str())),
                      first_curve(Geom::parse_svg_path(curve_out.c_str())), s);
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
    emscripten::function("pathsOverlap", &paths_overlap);
    emscripten::function("tweakPath", &tweak_path);
    emscripten::function("normalizePath", &normalize_path);
    emscripten::function("flattenPath", &flatten_path);
    emscripten::function("pathCrossings", &path_crossings);
    emscripten::function("simplifyPath", &simplify_path);
    emscripten::function("offsetPath", &offset_path);
    emscripten::function("strokeOutline", &stroke_outline);
    emscripten::function("nodesatTimeAtArcLength", &nodesat_time_at_arc_length);
    emscripten::function("nodesatArcLengthAt", &nodesat_arc_length_at);
    emscripten::function("nodesatRadToLen", &nodesat_rad_to_len);
    emscripten::function("nodesatLenToRad", &nodesat_len_to_rad);
    emscripten::function("bendPath", &bend_path);
    emscripten::function("pathBounds", &path_bounds);
    emscripten::function("transformPath", &transform_path);
    emscripten::function("reversePath", &reverse_path);
    emscripten::function("writePath", &write_path);
    emscripten::function("readPath", &read_path);
}
