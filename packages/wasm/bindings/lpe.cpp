// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for the 2geom parts of path effects whose upstream code works on
// Piecewise<D2<SBasis>>. Each function is the doEffect_pwd2() (or helper) of the
// effect named in its comment, with the parameters passed in; the effects themselves
// are ported to TypeScript (packages/core/src/live_effects). Geometry is SVG path data.
//
// Upstream: src/live_effects/effect.cpp (doEffect_path), src/live_effects/lpe-taperstroke.cpp,
// src/live_effects/lpe-envelope.cpp, src/live_effects/lpe-patternalongpath.cpp, src/live_effects/lpe-spiro.cpp
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/bezier-to-sbasis.h>
#include <2geom/d2.h>
#include <2geom/path.h>
#include <2geom/pathvector.h>
#include <2geom/piecewise.h>
#include <2geom/sbasis-geometric.h>
#include <2geom/sbasis-to-bezier.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include <functional>
#include "helper/geom-pathstroke.h"
#include "live_effects/spiro.h"

using namespace Geom;
using Pwd2 = Piecewise<D2<SBasis>>;

static constexpr double LPE_CONVERSION_TOLERANCE = 0.01; // effect.h

// Upstream: Effect::doEffect_path(): each path (or all, with concatenate) through the pwd2 function.
static std::string apply_pwd2(std::string const &d, bool concatenate, std::function<Pwd2(Pwd2 const &)> const &f)
{
    PathVector const path_in = parse_svg_path(d.c_str());
    PathVector path_out;
    if (!concatenate) {
        for (auto const &i : path_in) {
            Pwd2 pwd2_out = f(i.toPwSb());
            PathVector path = path_from_piecewise(pwd2_out, LPE_CONVERSION_TOLERANCE);
            for (auto const &j : path) {
                path_out.push_back(j);
            }
        }
    } else {
        Pwd2 pwd2_in;
        for (auto const &i : path_in) {
            pwd2_in.concat(i.toPwSb());
        }
        path_out = path_from_piecewise(f(pwd2_in), LPE_CONVERSION_TOLERANCE);
    }
    return write_svg_path(path_out);
}

static Pwd2 pwd2_of(std::string const &d)
{
    PathVector const pv = parse_svg_path(d.c_str());
    Pwd2 ret;
    for (auto const &p : pv) {
        ret.concat(p.toPwSb());
    }
    return ret;
}

// Upstream: lpe-taperstroke.cpp stretch_along(), then path_from_piecewise (first path).
static Pwd2 stretch_along(Pwd2 pwd2_in, Geom::Path pattern, double prop_scale)
{
    if (pattern.empty()) {
        return pwd2_in;
    }
    /* Much credit should go to jfb and mgsloan of lib2geom development for the code below! */
    Pwd2 output;
    std::vector<Pwd2> pre_output;
    D2<Piecewise<SBasis>> patternd2 = make_cuts_independent(pattern.toPwSb());
    Piecewise<SBasis> x0 = Piecewise<SBasis>(patternd2[0]);
    Piecewise<SBasis> y0 = Piecewise<SBasis>(patternd2[1]);
    OptInterval pattBndsX = bounds_exact(x0);
    OptInterval pattBndsY = bounds_exact(y0);
    if (pattBndsX && pattBndsY) {
        x0 -= pattBndsX->min();
        y0 -= pattBndsY->middle();
        double noffset = 0;
        double toffset = 0;
        // Prevent more than 90% overlap...
        y0 += noffset;
        std::vector<Pwd2> paths_in;
        paths_in = split_at_discontinuities(pwd2_in);
        for (auto path_i : paths_in) {
            Piecewise<SBasis> x = x0;
            Piecewise<SBasis> y = y0;
            Pwd2 uskeleton = arc_length_parametrization(path_i, 2, .1);
            uskeleton = remove_short_cuts(uskeleton, .01);
            Pwd2 n = rot90(derivative(uskeleton));
            n = force_continuity(remove_short_cuts(n, .1));
            int nbCopies = 0;
            double scaling = (uskeleton.domain().extent() - toffset) / pattBndsX->extent();
            nbCopies = 1;
            double pattWidth = pattBndsX->extent() * scaling;
            if (scaling != 1.0) {
                x *= scaling;
            }
            if (prop_scale != 1.0) y *= prop_scale;
            x += toffset;
            double offs = 0;
            for (int i = 0; i < nbCopies; i++) {
                output.concat(compose(uskeleton, x + offs) + y * compose(n, x + offs));
                offs += pattWidth;
            }
        }
        return output;
    } else {
        return pwd2_in;
    }
}

std::string taper_stretch_along(std::string const &d, std::string const &pattern, double width)
{
    Pwd2 pwd2;
    pwd2.concat(stretch_along(pwd2_of(d), parse_svg_path(pattern.c_str())[0], width));
    return write_svg_path(path_from_piecewise(pwd2, LPE_CONVERSION_TOLERANCE)[0]);
}

// Upstream: helper/geom-pathstroke.cpp half_outline() of the first path of d.
std::string half_outline_path(std::string const &d, double width, double miter, int join)
{
    PathVector const pv = parse_svg_path(d.c_str());
    if (pv.empty()) {
        return "";
    }
    return write_svg_path(Inkscape::half_outline(pv[0], width, miter, static_cast<Inkscape::LineJoinType>(join)));
}

// Upstream: lpe-envelope.cpp LPEEnvelope::doEffect_pwd2 (concatenate_before_pwd2). bbox is
// [x0, x1, y0, y1]; the four bend paths are top, right, bottom and left.
std::string envelope_path(std::string const &d, std::string const &b1, std::string const &b2, std::string const &b3,
                          std::string const &b4, double bx0, double bx1, double by0, double by1, bool xx, bool yy)
{
    Interval boundingbox_X(bx0, bx1);
    Interval boundingbox_Y(by0, by1);
    return apply_pwd2(d, true, [&](Pwd2 const &pwd2_in) -> Pwd2 {
        if (!xx && !yy) {
            return pwd2_in;
        }
        Pwd2 uskeleton1 = arc_length_parametrization(pwd2_of(b1), 2, .1);
        uskeleton1 = remove_short_cuts(uskeleton1, .01);
        Pwd2 n1 = rot90(derivative(uskeleton1));
        n1 = force_continuity(remove_short_cuts(n1, .1));
        Pwd2 uskeleton2 = arc_length_parametrization(pwd2_of(b2), 2, .1);
        uskeleton2 = remove_short_cuts(uskeleton2, .01);
        Pwd2 n2 = rot90(derivative(uskeleton2));
        n2 = force_continuity(remove_short_cuts(n2, .1));
        Pwd2 uskeleton3 = arc_length_parametrization(pwd2_of(b3), 2, .1);
        uskeleton3 = remove_short_cuts(uskeleton3, .01);
        Pwd2 n3 = rot90(derivative(uskeleton3));
        n3 = force_continuity(remove_short_cuts(n3, .1));
        Pwd2 uskeleton4 = arc_length_parametrization(pwd2_of(b4), 2, .1);
        uskeleton4 = remove_short_cuts(uskeleton4, .01);
        Pwd2 n4 = rot90(derivative(uskeleton4));
        n4 = force_continuity(remove_short_cuts(n4, .1));
        D2<Piecewise<SBasis>> patternd2 = make_cuts_independent(pwd2_in);
        Piecewise<SBasis> x = Piecewise<SBasis>(patternd2[0]);
        Piecewise<SBasis> y = Piecewise<SBasis>(patternd2[1]);
        /*The *1.001 is a hack to avoid a small bug : path at x=0 and y=0 don't work well. */
        x -= boundingbox_X.min() * 1.001;
        y -= boundingbox_Y.min() * 1.001;
        Piecewise<SBasis> x1 = x;
        Piecewise<SBasis> y1 = y;
        Piecewise<SBasis> x2 = x;
        Piecewise<SBasis> y2 = y;
        x2 -= boundingbox_X.extent();
        Piecewise<SBasis> x3 = x;
        Piecewise<SBasis> y3 = y;
        y3 -= boundingbox_Y.extent();
        Piecewise<SBasis> x4 = x;
        Piecewise<SBasis> y4 = y;
        /*Scaling to the Bend Path length*/
        double scaling1 = uskeleton1.cuts.back() / boundingbox_X.extent();
        if (scaling1 != 1.0) {
            x1 *= scaling1;
        }
        double scaling2 = uskeleton2.cuts.back() / boundingbox_Y.extent();
        if (scaling2 != 1.0) {
            y2 *= scaling2;
        }
        double scaling3 = uskeleton3.cuts.back() / boundingbox_X.extent();
        if (scaling3 != 1.0) {
            x3 *= scaling3;
        }
        double scaling4 = uskeleton4.cuts.back() / boundingbox_Y.extent();
        if (scaling4 != 1.0) {
            y4 *= scaling4;
        }
        Piecewise<SBasis> xbis = x;
        Piecewise<SBasis> ybis = y;
        xbis *= -1.0;
        xbis += boundingbox_X.extent();
        ybis *= -1.0;
        ybis += boundingbox_Y.extent();
        /* This is important : y + ybis = constant  and x +xbis = constant */
        Pwd2 output;
        Pwd2 output1;
        Pwd2 output2;
        Pwd2 output_x;
        Pwd2 output_y;
        output_y = ybis * (compose((uskeleton1), x1) + y1 * compose(n1, x1)) +
                   y * (compose((uskeleton3), x3) + y3 * compose(n3, x3));
        output_y /= (boundingbox_Y.extent());
        if (!xx && yy) {
            return output_y;
        }
        /*output_x : Deformation by Left and Right Bend Paths*/
        output_x = x * (compose((uskeleton2), y2) + -x2 * compose(n2, y2)) +
                   xbis * (compose((uskeleton4), y4) + -x4 * compose(n4, y4));
        output_x /= (boundingbox_X.extent());
        if (xx && !yy) {
            return output_x;
        }
        /*output : Deformation by Up, Left, Right and Down Bend Paths*/
        Piecewise<SBasis> xsqr = x * xbis; /* xsqr = x * (BBox_X - x) */
        Piecewise<SBasis> ysqr = y * ybis; /* xsqr = y * (BBox_Y - y) */
        Piecewise<SBasis> xsqrbis = xsqr;
        Piecewise<SBasis> ysqrbis = ysqr;
        xsqrbis *= -1;
        xsqrbis += boundingbox_X.extent() * boundingbox_X.extent() / 4.;
        ysqrbis *= -1;
        ysqrbis += boundingbox_Y.extent() * boundingbox_Y.extent() / 4.;
        output1 = (ysqrbis * output_y) + (ysqr * output_x);
        output1 /= (boundingbox_Y.extent() * boundingbox_Y.extent() / 4.);
        output2 = (xsqrbis * output_x) + (xsqr * output_y);
        output2 /= (boundingbox_X.extent() * boundingbox_X.extent() / 4.);
        output = output1 + output2;
        output /= 2.;
        return output;
    });
}

enum PAPCopyType { PAPCT_SINGLE = 0, PAPCT_SINGLE_STRETCHED, PAPCT_REPEATED, PAPCT_REPEATED_STRETCHED, PAPCT_END };

// Upstream: lpe-patternalongpath.cpp LPEPatternAlongPath::doEffect_pwd2 (per path).
std::string pattern_along_path(std::string const &d, std::string const &pattern_d, int type, double spacing,
                               double normal_offset, double tang_offset, bool prop_units, bool vertical_pattern,
                               double prop_scale, bool scale_y_rel, double fuse_tolerance)
{
    PathVector const pattern = parse_svg_path(pattern_d.c_str());
    return apply_pwd2(d, false, [&](Pwd2 const &pwd2_in) -> Pwd2 {
        if (pattern.empty()) {
            return pwd2_in;
        }
        /* Much credit should go to jfb and mgsloan of lib2geom development for the code below! */
        Pwd2 output;
        std::vector<Pwd2> pre_output;
        D2<Piecewise<SBasis>> patternd2 = make_cuts_independent(pwd2_of(pattern_d));
        Piecewise<SBasis> x0 = vertical_pattern ? Piecewise<SBasis>(patternd2[1]) : Piecewise<SBasis>(patternd2[0]);
        Piecewise<SBasis> y0 = vertical_pattern ? Piecewise<SBasis>(patternd2[0]) : Piecewise<SBasis>(patternd2[1]);
        OptInterval pattBndsX = bounds_exact(x0);
        OptInterval pattBndsY = bounds_exact(y0);
        if (pattBndsX && pattBndsY) {
            x0 -= pattBndsX->min();
            y0 -= pattBndsY->middle();
            double xspace = spacing;
            double noffset = normal_offset;
            double toffset = tang_offset;
            if (prop_units) {
                xspace *= pattBndsX->extent();
                noffset *= pattBndsY->extent();
                toffset *= pattBndsX->extent();
            }
            //Prevent more than 90% overlap...
            if (xspace < -pattBndsX->extent() * 0.9) {
                xspace = -pattBndsX->extent() * 0.9;
            }
            //TODO: dynamical update of parameter ranges?
            //if (prop_units.get_value()){
            //        spacing.param_set_range(-.9, Geom::infinity());
            //    }else{
            //        spacing.param_set_range(-pattBndsX.extent()*.9, Geom::infinity());
            //    }
            y0 += noffset;
            std::vector<Pwd2> paths_in;
            paths_in = split_at_discontinuities(pwd2_in);
            for (auto path_i : paths_in) {
                Piecewise<SBasis> x = x0;
                Piecewise<SBasis> y = y0;
                Pwd2 uskeleton = arc_length_parametrization(path_i, 2, 0.1);
                uskeleton = remove_short_cuts(uskeleton, 0.01);
                Pwd2 n = rot90(derivative(uskeleton));
                if (are_near(pwd2_in[0].at0(), pwd2_in[pwd2_in.size() - 1].at1(), 0.01)) {
                    n = force_continuity(remove_short_cuts(n, 0.1), 0.01);
                } else {
                    n = force_continuity(remove_short_cuts(n, 0.1));
                }
                int nbCopies = 0;
                double scaling = 1;
                switch (type) {
                    case PAPCT_REPEATED:
                        nbCopies = static_cast<int>(
                            floor((uskeleton.domain().extent() - toffset + xspace) / (pattBndsX->extent() + xspace)));
                        pattBndsX = Interval(pattBndsX->min(), pattBndsX->max() + xspace);
                        break;
                    case PAPCT_SINGLE:
                        nbCopies = (toffset + pattBndsX->extent() < uskeleton.domain().extent()) ? 1 : 0;
                        break;
                    case PAPCT_SINGLE_STRETCHED:
                        nbCopies = 1;
                        scaling = (uskeleton.domain().extent() - toffset) / pattBndsX->extent();
                        break;
                    case PAPCT_REPEATED_STRETCHED:
                        // if uskeleton is closed:
                        if (are_near(path_i.segs.front().at0(), path_i.segs.back().at1())) {
                            nbCopies = std::max(1, static_cast<int>(std::floor((uskeleton.domain().extent() - toffset) /
                                                                               (pattBndsX->extent() + xspace))));
                            pattBndsX = Interval(pattBndsX->min(), pattBndsX->max() + xspace);
                            scaling = (uskeleton.domain().extent() - toffset) /
                                      (((double)nbCopies) * pattBndsX->extent());
                            // if not closed: no space at the end
                        } else {
                            nbCopies =
                                std::max(1, static_cast<int>(std::floor((uskeleton.domain().extent() - toffset + xspace) /
                                                                        (pattBndsX->extent() + xspace))));
                            pattBndsX = Interval(pattBndsX->min(), pattBndsX->max() + xspace);
                            scaling = (uskeleton.domain().extent() - toffset) /
                                      (((double)nbCopies) * pattBndsX->extent() - xspace);
                        }
                        break;
                    default:
                        return pwd2_in;
                };
                //Ceil to 6 decimals
                scaling = ceil(scaling * 1000000) / 1000000;
                double pattWidth = pattBndsX->extent() * scaling;
                x *= scaling;
                if (scale_y_rel) {
                    y *= prop_scale * scaling;
                } else {
                    y *= prop_scale;
                }
                x += toffset;
                double offs = 0;
                for (int i = 0; i < nbCopies; i++) {
                    if (fuse_tolerance > 0) {
                        Pwd2 output_piece = compose(uskeleton, x + offs) + y * compose(n, x + offs);
                        std::vector<Pwd2> splited_output_piece = split_at_discontinuities(output_piece);
                        pre_output.insert(pre_output.end(), splited_output_piece.begin(), splited_output_piece.end());
                    } else {
                        output.concat(compose(uskeleton, x + offs) + y * compose(n, x + offs));
                    }
                    offs += pattWidth;
                }
            }
            if (fuse_tolerance > 0) {
                pre_output = fuse_nearby_ends(pre_output, fuse_tolerance);
                for (auto const &i : pre_output) {
                    output.concat(i);
                }
            }
            return output;
        } else {
            return pwd2_in;
        }
    });
}

// lpe-spiro.cpp sp_spiro_do_effect(): Spiro::spiro_run() of one subpath. xy is [x0, y0, x1, y1, ...],
// ty has one spiro_cp type character per point.
static std::string spiro_run_path(emscripten::val xy, std::string const &ty)
{
    auto const v = emscripten::vecFromJSArray<double>(xy);
    std::vector<Spiro::spiro_cp> cp(ty.size());
    for (size_t i = 0; i < ty.size(); i++) {
        cp[i] = {v[2 * i], v[2 * i + 1], ty[i]};
    }
    return write_svg_path(Geom::PathVector(Spiro::spiro_run(cp.data(), static_cast<int>(cp.size()))));
}

EMSCRIPTEN_BINDINGS(lpe)
{
    emscripten::function("spiroRun", &spiro_run_path);
    emscripten::function("taperStretchAlong", &taper_stretch_along);
    emscripten::function("halfOutline", &half_outline_path);
    emscripten::function("envelopePath", &envelope_path);
    emscripten::function("patternAlongPath", &pattern_along_path);
}
