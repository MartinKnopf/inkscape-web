// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for the piecewise SBasis (pwd2) parts of the path effects Ruler, Path length, Text label,
// Tangent to curve, Transform by 2 points, Stitch sub-paths and Interpolate points. The effects are
// ported to TypeScript (packages/core/src/live_effects). Geometry is SVG path data; functions that
// stand for one doEffect_pwd2 call take one subpath (Effect::doEffect_path calls doEffect_pwd2 per
// subpath).
//
// Upstream: src/live_effects/lpe-ruler.cpp, src/live_effects/lpe-path_length.cpp, src/live_effects/parameter/text.cpp, src/live_effects/lpe-text_label.cpp, src/live_effects/lpe-tangent_to_curve.cpp, src/live_effects/lpe-transform_2pts.cpp, src/live_effects/lpe-curvestitch.cpp, src/live_effects/lpe-interpolate_points.cpp, src/live_effects/effect.cpp
/*
 * Authors:
 *   Maximilian Albert
 *   Johan Engelen
 *
 * Copyright (C) Maximilian Albert 2008
 */
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/affine.h>
#include <2geom/path.h>
#include <2geom/pathvector.h>
#include <2geom/piecewise.h>
#include <2geom/sbasis-geometric.h>
#include <2geom/sbasis-math.h>
#include <2geom/sbasis-to-bezier.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include <2geom/transforms.h>
#include "live_effects/lpe-powerstroke-interpolators.h"

namespace {

using namespace Geom;
using Pwd2 = Piecewise<D2<SBasis>>;

constexpr double LPE_CONVERSION_TOLERANCE = 0.01; // effect.h

enum MarkType { MARK_MAJOR, MARK_MINOR };
enum MarkDirType { MARKDIR_LEFT, MARKDIR_RIGHT, MARKDIR_BOTH };
enum BorderMarkType { BORDERMARK_NONE, BORDERMARK_START, BORDERMARK_END, BORDERMARK_BOTH };

/** The first subpath of d as pwd2 (the input of one doEffect_pwd2 call). */
Pwd2 first_pwd2(std::string const &d)
{
    PathVector const pv = parse_svg_path(d.c_str());
    return pv.empty() ? Pwd2() : pv[0].toPwSb();
}

/** Effect::doEffect_path on every subpath of d with the transform m as doEffect_pwd2: pwd2_in * m. */
std::string pwd2_transformed(std::string const &d, emscripten::val m)
{
    auto const v = emscripten::vecFromJSArray<double>(m);
    Affine const affine(v[0], v[1], v[2], v[3], v[4], v[5]);
    PathVector const path_in = parse_svg_path(d.c_str());
    PathVector path_out;
    for (auto const &i : path_in) {
        Pwd2 const pwd2_out = i.toPwSb() * affine;
        for (auto const &j : path_from_piecewise(pwd2_out, LPE_CONVERSION_TOLERANCE)) {
            path_out.push_back(j);
        }
    }
    return write_svg_path(path_out);
}

/**
 * [end of the domain, then per t: x, y and the unit vector of the derivative] of the first subpath as
 * pwd2 (pwd2_in.valueAt(t), unit_vector(derivative(pwd2_in).valueAt(t))).
 */
emscripten::val pwd2_samples(std::string const &d, emscripten::val ts_val)
{
    auto const ts = emscripten::vecFromJSArray<double>(ts_val);
    Pwd2 const pwd2 = first_pwd2(d);
    std::vector<double> out;
    if (pwd2.empty()) {
        return emscripten::val::array(out);
    }
    Pwd2 const speed = derivative(pwd2);
    out.push_back(pwd2.cuts.back());
    for (double t : ts) {
        Point const p = pwd2.valueAt(t);
        Point const u = unit_vector(speed.valueAt(t));
        out.insert(out.end(), {p[X], p[Y], u[X], u[Y]});
    }
    return emscripten::val::array(out);
}

/**
 * [end of the domain, then per s: x, y and the unit vector of the derivative] of the arc length
 * parametrization of the first subpath (TextParam::setPosAndAnchor, LPECurveStitch).
 */
emscripten::val arc_length_samples(std::string const &d, emscripten::val ss_val)
{
    auto const ss = emscripten::vecFromJSArray<double>(ss_val);
    Pwd2 const pwd2 = first_pwd2(d);
    std::vector<double> out;
    if (pwd2.empty()) {
        return emscripten::val::array(out);
    }
    Pwd2 const reparam = arc_length_parametrization(pwd2, 2, 0.1);
    Pwd2 const speed = derivative(reparam);
    out.push_back(reparam.cuts.back());
    for (double s : ss) {
        Point const p = reparam.valueAt(s);
        Point const u = unit_vector(speed.valueAt(s));
        out.insert(out.end(), {p[X], p[Y], u[X], u[Y]});
    }
    return emscripten::val::array(out);
}

/** Geom::length(pwd2_in) of the first subpath. */
double pwd2_length(std::string const &d)
{
    Pwd2 const pwd2 = first_pwd2(d);
    return pwd2.empty() ? 0 : length(pwd2);
}

/** The parameters of LPERuler, with the lengths in document units already. */
struct Ruler
{
    double mark_length;
    double minor_mark_length;
    double major_mark_gap;
    double minor_mark_gap;
    double mark_angle;
    int mark_dir;

    Pwd2 ruler_mark(Point const &A, Point const &n, MarkType const &marktype) const
    {
        double const real_mark_length = mark_length;
        double const real_minor_mark_length = minor_mark_length;
        Point n_major = real_mark_length * n;
        Point n_minor = real_minor_mark_length * n;
        if (mark_dir == MARKDIR_BOTH) {
            n_major = n_major * 0.5;
            n_minor = n_minor * 0.5;
        }

        Point C, D;
        double factor = 1.0;
        double mark_gap = 0;
        switch (marktype) {
            case MARK_MAJOR:
                mark_gap = major_mark_gap;
                C = A;
                D = A + n_major;
                if (real_mark_length && real_minor_mark_length && real_mark_length < real_minor_mark_length) {
                    factor = real_mark_length / real_minor_mark_length;
                }
                if (mark_dir == MARKDIR_BOTH)
                    C -= n_major;
                break;
            case MARK_MINOR:
                mark_gap = minor_mark_gap;
                if (real_mark_length && real_minor_mark_length && real_mark_length > real_minor_mark_length) {
                    factor = real_minor_mark_length / real_mark_length;
                }
                C = A;
                D = A + n_minor;
                if (mark_dir == MARKDIR_BOTH)
                    C -= n_minor;
                break;
            default:
                break;
        }

        Pwd2 seg(D2<SBasis>(SBasis(C[X], D[X]), SBasis(C[Y], D[Y])));
        if (mark_angle || mark_gap) {
            PathVector pvec = path_from_piecewise(seg, 0.0001);
            if (mark_angle) {
                pvec *= Translate(A).inverse();
                pvec *= Rotate(rad_from_deg(mark_angle));
                pvec *= Translate(A);
                seg = paths_to_pw(pvec);
            }
            if (mark_gap) {
                PathVector pv;
                if (mark_dir == MARKDIR_BOTH) {
                    pv.push_back(pvec[0].portion(0, 0.5 - ((mark_gap * 0.5 * (1 + (1 - factor))) / 100.0)));
                    pv.push_back(pvec[0].portion(0.5 + ((mark_gap * 0.5 * (1 + (1 - factor))) / 100.0), 1));
                } else {
                    pv.push_back(pvec[0].portion((mark_gap * (1 + (1 - factor))) / 100.0, 1));
                }
                seg = paths_to_pw(pv);
            }
        }
        return seg;
    }
};

/**
 * LPERuler::doEffect_pwd2 on the first subpath of d, with the document unit conversions of the
 * lengths done by the caller. Returns the output as path data.
 */
std::string ruler_path(std::string const &d, double real_mark_distance, double real_offset, double offset,
                       double mark_length, double minor_mark_length, double major_mark_gap, double minor_mark_gap,
                       double mark_angle, int mark_dir, int border_marks, int mminterval, int i_shift)
{
    Pwd2 const pwd2_in = first_pwd2(d);
    if (pwd2_in.empty()) {
        return "";
    }
    Ruler const ruler{mark_length, minor_mark_length, major_mark_gap, minor_mark_gap, mark_angle, mark_dir};
    int const sign = (mark_dir == MARKDIR_RIGHT ? 1 : -1);

    Pwd2 output(pwd2_in);
    Pwd2 speed = derivative(pwd2_in);
    Piecewise<SBasis> arclength = arcLengthSb(pwd2_in);
    double totlength = arclength.lastValue();

    // find at which times to draw a mark:
    std::vector<double> s_cuts;
    for (double s = real_offset; s < totlength; s += real_mark_distance) {
        s_cuts.push_back(s);
    }
    std::vector<std::vector<double>> roots = multi_roots(arclength, s_cuts);
    std::vector<double> t_cuts;
    for (auto &root : roots) {
        if (root.size() > 0)
            t_cuts.push_back(root[0]);
    }
    // draw the marks
    for (size_t i = 0; i < t_cuts.size(); i++) {
        Point A = pwd2_in(t_cuts[i]);
        Point n = rot90(unit_vector(speed(t_cuts[i]))) * sign;
        if (static_cast<int>(i % mminterval) == i_shift) {
            output.concat(ruler.ruler_mark(A, n, MARK_MAJOR));
        } else {
            output.concat(ruler.ruler_mark(A, n, MARK_MINOR));
        }
    }
    // eventually draw a mark at start
    if ((border_marks == BORDERMARK_START || border_marks == BORDERMARK_BOTH) && (offset != 0.0 || i_shift != 0)) {
        Point A = pwd2_in.firstValue();
        Point n = rot90(unit_vector(speed.firstValue())) * sign;
        output.concat(ruler.ruler_mark(A, n, MARK_MAJOR));
    }
    // eventually draw a mark at end
    if (border_marks == BORDERMARK_END || border_marks == BORDERMARK_BOTH) {
        Point A = pwd2_in.lastValue();
        Point n = rot90(unit_vector(speed.lastValue())) * sign;
        // speed.lastValue() is sometimes wrong when the path is closed: a tiny line seg might added at the end to
        // fix rounding errors...
        if (A == pwd2_in.firstValue() && speed.segs.size() > 1 && speed.segs.back()[X].size() <= 1 &&
            speed.segs.back()[Y].size() <= 1 && speed.segs.back()[X].tailError(0) <= 1e-10 &&
            speed.segs.back()[Y].tailError(0) <= 1e-10) {
            n = rot90(unit_vector(speed.segs[speed.segs.size() - 2].at1())) * sign;
        }
        output.concat(ruler.ruler_mark(A, n, MARK_MAJOR));
    }

    return write_svg_path(path_from_piecewise(output, LPE_CONVERSION_TOLERANCE));
}

/** LPEInterpolatePoints::doEffect_path for one subpath: the points are [x0, y0, x1, y1, ...]. */
std::string interpolate_points(emscripten::val xy_val, int type)
{
    auto const xy = emscripten::vecFromJSArray<double>(xy_val);
    std::vector<Point> pts;
    for (size_t i = 0; i + 1 < xy.size(); i += 2) {
        pts.emplace_back(xy[i], xy[i + 1]);
    }
    std::unique_ptr<Interpolate::Interpolator> interpolator(
        Interpolate::Interpolator::create(static_cast<Interpolate::InterpolatorType>(type)));
    PathVector pv;
    pv.push_back(interpolator->interpolateToPath(pts));
    return write_svg_path(pv);
}

} // namespace

EMSCRIPTEN_BINDINGS(lpe_pwd2_constructions)
{
    emscripten::function("pwd2Transformed", &pwd2_transformed);
    emscripten::function("pwd2Samples", &pwd2_samples);
    emscripten::function("arcLengthSamples", &arc_length_samples);
    emscripten::function("pwd2Length", &pwd2_length);
    emscripten::function("rulerPath", &ruler_path);
    emscripten::function("interpolatePoints", &interpolate_points);
}
