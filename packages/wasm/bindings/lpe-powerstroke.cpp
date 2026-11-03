// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for the 2geom part of the Power stroke LPE: the outline of one subpath
// (the loop body of LPEPowerStroke::doEffect_path) with path_from_piecewise_fix_cusps().
// The effect, its parameters and knots are ported to TypeScript
// (packages/core/src/live_effects/lpe-powerstroke.ts). Geometry is SVG path data.
//
// Upstream: src/live_effects/lpe-powerstroke.cpp, src/live_effects/lpe-powerstroke-interpolators.h
/* Authors:
 *   Johan Engelen <j.b.c.engelen@alumnus.utwente.nl>
 *
 * Copyright (C) 2010-2012 Authors
 */
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/circle.h>
#include <2geom/elliptical-arc.h>
#include <2geom/path-intersection.h>
#include <2geom/path-sink.h>
#include <2geom/piecewise.h>
#include <2geom/sbasis-geometric.h>
#include <2geom/sbasis-to-bezier.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include "live_effects/lpe-powerstroke-interpolators.h"
#include "live_effects/spiro.h"

namespace Geom {

/** Find the point where two straight lines cross.
*/
static std::optional<Point> intersection_point( Point const & origin_a, Point const & vector_a,
                                           Point const & origin_b, Point const & vector_b)
{
    Coord denom = cross(vector_a, vector_b);
    if (!are_near(denom,0.)){
        Coord t = (cross(vector_b, origin_a) + cross(origin_b, vector_b)) / denom;
        return origin_a + t * vector_a;
    }
    return std::nullopt;
}

static Geom::CubicBezier sbasis_to_cubicbezier(Geom::D2<Geom::SBasis> const & sbasis_in)
{
    std::vector<Geom::Point> temp;
    sbasis_to_bezier(temp, sbasis_in, 4);
    return Geom::CubicBezier( temp );
}

/**
 * very quick: this finds the ellipse with minimum eccentricity
   passing through point P and Q, with tangent PO at P and QO at Q
   http://mathforum.org/kb/message.jspa?messageID=7471596&tstart=0
 */
static Ellipse find_ellipse(Point P, Point Q, Point O)
{
    Point p = P - O;
    Point q = Q - O;
    Coord K = 4 * dot(p,q) / (L2sq(p) + L2sq(q));

    double cross = p[Y]*q[X] - p[X]*q[Y];
    double a = -q[Y]/cross;
    double b = q[X]/cross;
    double c = (O[X]*q[Y] - O[Y]*q[X])/cross;

    double d = p[Y]/cross;
    double e = -p[X]/cross;
    double f = (-O[X]*p[Y] + O[Y]*p[X])/cross;

    // Ax^2 + Bxy + Cy^2 + Dx + Ey + F = 0
    double A = (a*d*K+d*d+a*a);
    double B = (a*e*K+b*d*K+2*d*e+2*a*b);
    double C = (b*e*K+e*e+b*b);
    double D = (a*f*K+c*d*K+2*d*f-2*d+2*a*c-2*a);
    double E = (b*f*K+c*e*K+2*e*f-2*e+2*b*c-2*b);
    double F = c*f*K+f*f-2*f+c*c-2*c+1;

    return Ellipse(A, B, C, D, E, F);
}

/**
 * Find circle that touches inside of the curve, with radius matching the curvature, at time value \c t.
 * Because this method internally uses unitTangentAt, t should be smaller than 1.0 (see unitTangentAt).
 */
static Circle touching_circle( D2<SBasis> const &curve, double t, double tol=0.01 )
{
    D2<SBasis> dM=derivative(curve);
    if ( are_near(L2sq(dM(t)),0.) && (dM[0].size() > 1) && (dM[1].size() > 1) ) {
        dM=derivative(dM);
    }
    if ( are_near(L2sq(dM(t)),0.) && (dM[0].size() > 1) && (dM[1].size() > 1) ) {   // try second time
        dM=derivative(dM);
    }
    if ( dM.isZero(tol) || (are_near(L2sq(dM(t)),0.) && (dM[0].size() > 1) && (dM[1].size() > 1) )) {   // admit defeat
        return Geom::Circle(Geom::Point(0., 0.), 0.);
    }
    Piecewise<D2<SBasis> > unitv = unitVector(dM,tol);
    if (unitv.empty()) {   // admit defeat
        return Geom::Circle(Geom::Point(0., 0.), 0.);
    }
    Piecewise<SBasis> dMlength = dot(Piecewise<D2<SBasis> >(dM),unitv);
    Piecewise<SBasis> k = cross(derivative(unitv),unitv);
    k = divide(k,dMlength,tol,3);
    double curv = k(t); // note that this value is signed

    Geom::Point normal = unitTangentAt(curve, t).cw();
    double radius = 1/curv;
    Geom::Point center = curve(t) + radius*normal;
    return Geom::Circle(center, fabs(radius));
}

} // namespace Geom

namespace {

using namespace Geom;

enum LineCapType { LINECAP_BUTT, LINECAP_SQUARE, LINECAP_ROUND, LINECAP_PEAK, LINECAP_ZERO_WIDTH };

enum LineJoinType {
  LINEJOIN_BEVEL,
  LINEJOIN_ROUND,
  LINEJOIN_EXTRP_MITER,
  LINEJOIN_MITER,
  LINEJOIN_SPIRO,
  LINEJOIN_EXTRP_MITER_ARC
};

constexpr double LPE_CONVERSION_TOLERANCE = 0.01; // effect.h

bool compare_offsets (Geom::Point first, Geom::Point second)
{
    return first[Geom::X] < second[Geom::X];
}

Geom::Path path_from_piecewise_fix_cusps( Geom::Piecewise<Geom::D2<Geom::SBasis> > const & B,
                                                 Geom::Piecewise<Geom::SBasis> const & y, // width path
                                                 LineJoinType jointype,
                                                 double miter_limit,
                                                 double tol=Geom::EPSILON)
{
/* per definition, each discontinuity should be fixed with a join-ending, as defined by linejoin_type
*/
    Geom::PathBuilder pb;
    Geom::OptRect bbox = bounds_fast(B);
    if (B.empty() || !bbox) {
        return pb.peek().front();
    }

    pb.setStitching(true);

    Geom::Point start = B[0].at0();
    pb.moveTo(start);
    build_from_sbasis(pb, B[0], tol, false);
    unsigned prev_i = 0;
    for (unsigned i=1; i < B.size(); i++) {
        // Skip degenerate segments. The number below was determined, after examining
        // very many paths with powerstrokes of all shapes and sizes, to allow filtering out most
        // degenerate segments without losing significant quality; it is close to 1/256.
        if (B[i].isConstant(4e-3)) {
            continue;
        }
        if (!are_near(B[prev_i].at1(), B[i].at0(), tol) )
        { // discontinuity found, so fix it :-)
            double width = y( B.cuts[i] );

            Geom::Point tang1 = -unitTangentAt(reverse(B[prev_i]),0.); // = unitTangentAt(B[prev_i],1);
            Geom::Point tang2 = unitTangentAt(B[i],0);
            Geom::Point discontinuity_vec = B[i].at0() - B[prev_i].at1();
            bool on_outside = ( dot(tang1, discontinuity_vec) >= 0. );

            if (on_outside) {
                // we are on the outside: add some type of join!
                switch (jointype) {
                case LINEJOIN_ROUND: {
                    /* for constant width paths, the rounding is a circular arc (rx == ry),
                       for non-constant width paths, the rounding can be done with an ellipse but is hard and ambiguous.
                       The elliptical arc should go through the discontinuity's start and end points (of course!)
                       and also should match the discontinuity tangents at those start and end points.
                       To resolve the ambiguity, the elliptical arc with minimal eccentricity should be chosen.
                       A 2Geom method was created to do exactly this :)
                       */

                    std::optional<Geom::Point> O = intersection_point( B[prev_i].at1(), tang1,
                                                                              B[i].at0(), tang2 );
                    if (!O) {
                        // no center found, i.e. 180 degrees round
                       pb.lineTo(B[i].at0()); // default to bevel for too shallow cusp angles
                       break;
                    }

                    Geom::Ellipse ellipse;
                    try {
                        ellipse = find_ellipse(B[prev_i].at1(), B[i].at0(), *O);
                    }
                    catch (Geom::LogicalError &e) {
                        // 2geom did not find a fitting ellipse, this happens for weird thick paths :)
                        // do bevel, and break
                         pb.lineTo(B[i].at0());
                         break;
                    }
                    catch (Geom::RangeError &e) {
                        // 2geom did not find a fitting ellipse, this happens for weird thick paths :)
                        // do bevel, and break
                         pb.lineTo(B[i].at0());
                         break;
                    }

                    // check if ellipse.ray is within 'sane' range.
                    if ( ( fabs(ellipse.ray(Geom::X)) > 1e6 ) ||
                         ( fabs(ellipse.ray(Geom::Y)) > 1e6 ) )
                    {
                        // do bevel, and break
                         pb.lineTo(B[i].at0());
                         break;
                    }

                    pb.arcTo( ellipse.ray(Geom::X), ellipse.ray(Geom::Y), ellipse.rotationAngle(),
                              false, width < 0, B[i].at0() );

                    break;
                }
                case LINEJOIN_EXTRP_MITER: {
                    Geom::D2<Geom::SBasis> newcurve1 = B[prev_i] * Geom::reflection(rot90(tang1), B[prev_i].at1());
                    Geom::CubicBezier bzr1 = sbasis_to_cubicbezier( reverse(newcurve1) );

                    Geom::D2<Geom::SBasis> newcurve2 = B[i] * Geom::reflection(rot90(tang2), B[i].at0());
                    Geom::CubicBezier bzr2 = sbasis_to_cubicbezier( reverse(newcurve2) );

                    Geom::Crossings cross = crossings(bzr1, bzr2);
                    if (cross.empty()) {
                        // empty crossing: default to bevel
                        pb.lineTo(B[i].at0());
                    } else {
                        // check size of miter
                        Geom::Point point_on_path = B[prev_i].at1() - rot90(tang1) * width;
                        Geom::Coord len = distance(bzr1.pointAt(cross[0].ta), point_on_path);
                        if (len > fabs(width) * miter_limit) {
                            // miter too big: default to bevel
                            pb.lineTo(B[i].at0());
                        } else {
                            std::pair<Geom::CubicBezier, Geom::CubicBezier> sub1 = bzr1.subdivide(cross[0].ta);
                            std::pair<Geom::CubicBezier, Geom::CubicBezier> sub2 = bzr2.subdivide(cross[0].tb);
                            pb.curveTo(sub1.first[1], sub1.first[2], sub1.first[3]);
                            pb.curveTo(sub2.second[1], sub2.second[2], sub2.second[3]);
                        }
                    }
                    break;
                }
                case LINEJOIN_EXTRP_MITER_ARC: {
                    // Extrapolate using the curvature at the end of the path segments to join
                    Geom::Circle circle1 = Geom::touching_circle(reverse(B[prev_i]), 0.0);
                    Geom::Circle circle2 = Geom::touching_circle(B[i], 0.0);
                    std::vector<Geom::ShapeIntersection> solutions;
                    solutions = circle1.intersect(circle2);
                    if (solutions.size() == 2) {
                        Geom::Point sol(0.,0.);
                        bool solok = true;
                        bool point0bad = false;
                        bool point1bad = false;
                        if ( dot(tang2, solutions[0].point() - B[i].at0()) > 0)
                        {
                            // points[0] is bad, choose points[1]
                            point0bad = true;
                        }
                        if ( dot(tang2, solutions[1].point() - B[i].at0()) > 0)
                        {
                            // points[1] is bad, choose points[0]
                            point1bad = true;
                        }
                        if (!point0bad && !point1bad ) {
                            // both points are good, choose nearest
                            sol = ( distanceSq(B[i].at0(), solutions[0].point()) < distanceSq(B[i].at0(), solutions[1].point()) ) ?
                                    solutions[0].point() : solutions[1].point();
                        } else if (!point0bad) {
                            sol = solutions[0].point();
                        } else if (!point1bad) {
                            sol = solutions[1].point();
                        } else {
                            solok = false;
                        }
                        (*bbox).expandBy (bbox->width()/4);

                        if (!(*bbox).contains(sol)) {
                            solok = false;
                        }
                        Geom::EllipticalArc *arc0 = nullptr;
                        Geom::EllipticalArc *arc1 = nullptr;
                        bool build = false;
                        if (solok) {
                            arc0 = circle1.arc(B[prev_i].at1(), 0.5*(B[prev_i].at1()+sol), sol);
                            arc1 = circle2.arc(sol, 0.5*(sol+B[i].at0()), B[i].at0());
                            if (arc0) {
                                // FIX: Some assertions errors here
                                build_from_sbasis(pb,arc0->toSBasis(), tol, false);
                                build = true;
                            } else if (arc1) {
                                std::optional<Geom::Point> p = intersection_point( B[prev_i].at1(), tang1,
                                                                                B[i].at0(), tang2 );
                                if (p) {
                                    // check size of miter
                                    Geom::Point point_on_path = B[prev_i].at1() - rot90(tang1) * width;
                                    Geom::Coord len = distance(*p, point_on_path);
                                    if (len <= fabs(width) * miter_limit) {
                                        // miter OK
                                        pb.lineTo(*p);
                                        build = true;
                                    }
                                }
                            }
                            if (build) {
                                build_from_sbasis(pb,arc1->toSBasis(), tol, false);
                            } else if (arc0) {
                                pb.lineTo(B[i].at0());
                            }
                        }
                        if (!solok || !(arc0 && build)) {
                            // fall back to miter
                            std::optional<Geom::Point> p = intersection_point( B[prev_i].at1(), tang1,
                                                                                B[i].at0(), tang2 );
                            if (p) {
                                // check size of miter
                                Geom::Point point_on_path = B[prev_i].at1() - rot90(tang1) * width;
                                Geom::Coord len = distance(*p, point_on_path);
                                if (len <= fabs(width) * miter_limit) {
                                    // miter OK
                                    pb.lineTo(*p);
                                }
                            }
                            pb.lineTo(B[i].at0());
                        }
                        if (arc0) {
                            delete arc0;
                            arc0 = nullptr;
                        }
                        if (arc1) {
                            delete arc1;
                            arc1 = nullptr;
                        }
                    } else {
                        // fall back to miter
                        std::optional<Geom::Point> p = intersection_point( B[prev_i].at1(), tang1,
                                                                            B[i].at0(), tang2 );
                        if (p) {
                            // check size of miter
                            Geom::Point point_on_path = B[prev_i].at1() - rot90(tang1) * width;
                            Geom::Coord len = distance(*p, point_on_path);
                            if (len <= fabs(width) * miter_limit) {
                                // miter OK
                                pb.lineTo(*p);
                            }
                        }
                        pb.lineTo(B[i].at0());
                    }
                    break;
                }
                case LINEJOIN_MITER: {
                    std::optional<Geom::Point> p = intersection_point( B[prev_i].at1(), tang1,
                                                                         B[i].at0(), tang2 );
                    if (p) {
                        // check size of miter
                        Geom::Point point_on_path = B[prev_i].at1() - rot90(tang1) * width;
                        Geom::Coord len = distance(*p, point_on_path);
                        if (len <= fabs(width) * miter_limit) {
                            // miter OK
                            pb.lineTo(*p);
                        }
                    }
                    pb.lineTo(B[i].at0());
                    break;
                }
                case LINEJOIN_SPIRO: {
                    Geom::Point direction = B[i].at0() - B[prev_i].at1();
                    double tang1_sign = dot(direction,tang1);
                    double tang2_sign = dot(direction,tang2);

                    Spiro::spiro_cp controlpoints[4];
                    controlpoints[0].x = (B[prev_i].at1() - tang1_sign*tang1)[Geom::X];
                    controlpoints[0].y = (B[prev_i].at1() - tang1_sign*tang1)[Geom::Y];
                    controlpoints[0].ty = '{';
                    controlpoints[1].x = B[prev_i].at1()[Geom::X];
                    controlpoints[1].y = B[prev_i].at1()[Geom::Y];
                    controlpoints[1].ty = ']';
                    controlpoints[2].x = B[i].at0()[Geom::X];
                    controlpoints[2].y = B[i].at0()[Geom::Y];
                    controlpoints[2].ty = '[';
                    controlpoints[3].x = (B[i].at0() + tang2_sign*tang2)[Geom::X];
                    controlpoints[3].y = (B[i].at0() + tang2_sign*tang2)[Geom::Y];
                    controlpoints[3].ty = '}';

                    auto spiro = Spiro::spiro_run(controlpoints, 4);
                    pb.append(spiro.portion(1, spiro.size_open() - 1));
                    break;
                }
                case LINEJOIN_BEVEL:
                default:
                    pb.lineTo(B[i].at0());
                    break;
                }

                build_from_sbasis(pb, B[i], tol, false);

            } else {
                // we are on inside of corner!
                Geom::Path bzr1 = path_from_sbasis( B[prev_i], tol );
                Geom::Path bzr2 = path_from_sbasis( B[i], tol );
                Geom::Crossings cross = crossings(bzr1, bzr2);
                if (cross.size() != 1) {
                    // empty crossing or too many crossings: default to bevel
                    pb.lineTo(B[i].at0());
                    pb.append(bzr2);
                } else {
                    // :-) quick hack:
                    for (unsigned i=0; i < bzr1.size_open(); ++i) {
                        pb.backspace();
                    }

                    pb.append( bzr1.portion(0, cross[0].ta) );
                    pb.append( bzr2.portion(cross[0].tb, bzr2.size_open()) );
                }
            }
        } else {
            build_from_sbasis(pb, B[i], tol, false);
        }

        prev_i = i;
    }
    pb.flush();
    return pb.peek().front();
}

/**
 * Path data of pv like sp_svg_write_path(): stitch segments (added by PathBuilder with
 * stitching) are not written.
 */
std::string write_without_stitches(PathVector const &pv)
{
    Geom::SVGPathWriter writer;
    writer.setPrecision(-1);
    for (auto const &path : pv) {
        writer.moveTo(path.initialPoint());
        for (auto it = path.begin(); it != path.end_open(); ++it) {
            if (!dynamic_cast<Geom::Path::StitchSegment const *>(&*it)) {
                it->feed(writer, false);
            }
        }
        if (path.closed()) {
            writer.closePath();
        }
    }
    writer.flush();
    return writer.str();
}

/**
 * The outline of one subpath (path data with one path; lines and cubic Beziers only).
 * ts_flat holds the width points of the subpath [x0, y0, x1, y1, ...]: x relative to the start
 * of the subpath, y already multiplied by scale_width. Returns path data with one path (open
 * subpaths) or two (closed ones), or "" when nothing is drawn.
 */
std::string powerstroke_path(std::string const &d, emscripten::val ts_flat, bool legacy, bool sort_points,
                             int interpolator_type, double interpolator_beta, int start_cap, int end_cap,
                             int join, double miter_limit)
{
    PathVector const pv = parse_svg_path(d.c_str());
    if (pv.empty()) {
        return "";
    }
    Geom::Path const &path = pv[0];
    PathVector path_out;

    Piecewise<D2<SBasis> > pwd2_in = path.toPwSb();
    if (pwd2_in.empty()) {
        return "";
    }
    Piecewise<D2<SBasis> > der = derivative(pwd2_in);
    if (der.empty()) {
        return "";
    }
    Piecewise<D2<SBasis> > n = unitVector(der,0.00001);
    if (n.empty()) {
        return "";
    }

    n = rot90(n);

    LineCapType end_linecap = static_cast<LineCapType>(end_cap);
    LineCapType start_linecap = static_cast<LineCapType>(start_cap);

    auto const flat = emscripten::vecFromJSArray<double>(ts_flat);
    std::vector<Geom::Point> ts;
    for (size_t i = 0; i + 1 < flat.size(); i += 2) {
        ts.emplace_back(flat[i], flat[i + 1]);
    }
    if (sort_points) {
        sort(ts.begin(), ts.end(), compare_offsets);
    }
    // create stroke path where points (x,y) := (t, offset)
    Geom::Interpolate::Interpolator *interpolator = Geom::Interpolate::Interpolator::create(static_cast<Geom::Interpolate::InterpolatorType>(interpolator_type));
    if (Geom::Interpolate::CubicBezierJohan *johan = dynamic_cast<Geom::Interpolate::CubicBezierJohan*>(interpolator)) {
        johan->setBeta(interpolator_beta);
    }
    if (Geom::Interpolate::CubicBezierSmooth *smooth = dynamic_cast<Geom::Interpolate::CubicBezierSmooth*>(interpolator)) {
        smooth->setBeta(interpolator_beta);
    }
    if (path.closed() && ts.size()) {
        std::vector<Geom::Point> ts_close;
        //we have only one knot or overwrite before
        Geom::Point start = Geom::Point( pwd2_in.domain().min(), ts.front()[Geom::Y]);
        Geom::Point end   = Geom::Point( pwd2_in.domain().max(), ts.front()[Geom::Y]);
        if (ts.size() > 1) {
            if (legacy) {
                end = Geom::Point(pwd2_in.domain().max(), 0);
                Geom::Point tmpstart(0, 0);
                tmpstart[Geom::X] = end[Geom::X] + ts.front()[Geom::X];
                tmpstart[Geom::Y] = ts.front()[Geom::Y];
                ts_close.push_back(ts.back());
                ts_close.push_back(middle_point(tmpstart, ts.back()));
                ts_close.push_back(tmpstart);
                Geom::Path closepath = interpolator->interpolateToPath(ts_close);
                end = closepath.pointAt(Geom::nearest_time(end, closepath));
                end[Geom::X] = pwd2_in.domain().max();
                start = end;
                start[Geom::X] = pwd2_in.domain().min();
            } else {
                double pl = 1;
                double pl2 = 0;
                if (ts.front()[Geom::X] > 0) {
                    Geom::Path p = path.portion(pwd2_in.domain().min(),ts.front()[Geom::X]);
                    pl = 0;
                    for (size_t i = 0; i < p.size_open(); i++) {
                        pl += p.curveAt(i).length();
                    }
                }
                if (pwd2_in.domain().max() != ts.back()[Geom::X]) {
                    Geom::Path p2 = path.portion(ts.back()[Geom::X], pwd2_in.domain().max());
                    pl2 = 0;
                    for (size_t i = 0; i < p2.size_open(); i++) {
                        pl2 += p2.curveAt(i).length();
                    }
                }
                int signfront = ts.front()[Geom::Y] > 0 ? 1 : -1;
                int signback  = ts.back() [Geom::Y] > 0 ? 1 : -1;
                int sign = 1;
                bool inverted = std::abs(ts.front()[Geom::Y]) > std::abs(ts.back()[Geom::Y]);
                double min = std::min(std::abs(ts.front()[Geom::Y]), std::abs(ts.back()[Geom::Y]));
                double max = std::max(std::abs(ts.front()[Geom::Y]), std::abs(ts.back()[Geom::Y]));
                if (signfront < 0 && signback < 0) {
                    min *= -1;
                    max *= -1;
                    sign = -1;
                } else if (signfront < 0) {
                    max *= max == std::abs(ts.front()[Geom::Y]) ? signfront : signback;
                    min *= min == std::abs(ts.front()[Geom::Y]) ? signback  : signfront;
                } else if (signback < 0) {
                    max *= max == std::abs(ts.front()[Geom::Y]) ? signfront : signback;
                    min *= min == std::abs(ts.front()[Geom::Y]) ? signback  : signfront;
                }
                double gap = std::abs(max-min);
                double factor1 = pl/(pl + pl2);
                double factor2 = pl2/(pl + pl2);
                bool toggled = false;
                if (!inverted) {
                    toggled = true;
                }
                end = Geom::Point(pwd2_in.domain().max(),((std::abs(min) + (gap * (toggled ? factor1 : factor2)))  * sign));
                start = end;
                start[Geom::X] = pwd2_in.domain().min();
            }
        }
        ts.insert(ts.begin(), start );
        ts.push_back( end );
        if (legacy) {
            ts_close.clear();
        }
    } else {
        // add width data for first and last point on the path
        // depending on cap type, these first and last points have width zero or take the width from the closest width point.
        auto start_y = (start_linecap == LINECAP_ZERO_WIDTH || ts.empty()) ? 0. : ts.front()[Geom::Y];
        auto end_y = (end_linecap == LINECAP_ZERO_WIDTH || ts.empty()) ? 0. : ts.back()[Geom::Y];
        ts.insert(ts.begin(), Geom::Point(pwd2_in.domain().min(), start_y));
        ts.emplace_back(pwd2_in.domain().max(), end_y);
    }

    // do the interpolation in a coordinate system that is more alike to the on-canvas knots,
    // instead of the heavily compressed coordinate system of (segment_no offset, Y) in which the knots are stored
    double pwd2_in_arclength = length(pwd2_in);
    double xcoord_scaling = pwd2_in_arclength / ts.back()[Geom::X];
    for (auto & t : ts) {
        t[Geom::X] *= xcoord_scaling;
    }

    Geom::Path strokepath = interpolator->interpolateToPath(ts);
    delete interpolator;

    // apply the inverse knot-xcoord scaling that was applied before the interpolation
    strokepath *= Scale(1/xcoord_scaling, 1);

    D2<Piecewise<SBasis> > patternd2 = make_cuts_independent(strokepath.toPwSb());
    Piecewise<SBasis> x = Piecewise<SBasis>(patternd2[0]);
    Piecewise<SBasis> y = Piecewise<SBasis>(patternd2[1]);
    // find time values for which x lies outside path domain
    // and only take portion of x and y that lies within those time values
    std::vector< double > rtsmin = roots (x - pwd2_in.domain().min());
    std::vector< double > rtsmax = roots (x + pwd2_in.domain().max());
    if ( !rtsmin.empty() && !rtsmax.empty() ) {
        x = portion(x, rtsmin.at(0), rtsmax.at(0));
        y = portion(y, rtsmin.at(0), rtsmax.at(0));
    }

    LineJoinType jointype = static_cast<LineJoinType>(join);
    if (x.empty() || y.empty()) {
        return "";
    }
    Piecewise<D2<SBasis> > pwd2_out   = compose(pwd2_in,x) + y*compose(n,x);
    Piecewise<D2<SBasis> > mirrorpath = reverse( compose(pwd2_in,x) - y*compose(n,x));

    Geom::Path fixed_path       = path_from_piecewise_fix_cusps( pwd2_out,   y,          jointype, miter_limit, LPE_CONVERSION_TOLERANCE);
    Geom::Path fixed_mirrorpath = path_from_piecewise_fix_cusps( mirrorpath, reverse(y), jointype, miter_limit, LPE_CONVERSION_TOLERANCE);
    if (path.closed()) {
        fixed_path.close(true);
        path_out.push_back(fixed_path);
        fixed_mirrorpath.close(true);
        path_out.push_back(fixed_mirrorpath);
    } else {
        // add linecaps...
        switch (end_linecap) {
            case LINECAP_ZERO_WIDTH:
                // do nothing
                break;
            case LINECAP_PEAK:
            {
                Geom::Point end_deriv = -unitTangentAt( reverse(pwd2_in.segs.back()), 0.);
                double radius = 0.5 * distance(fixed_path.finalPoint(), fixed_mirrorpath.initialPoint());
                Geom::Point midpoint = 0.5*(fixed_path.finalPoint() + fixed_mirrorpath.initialPoint()) + radius*end_deriv;
                fixed_path.appendNew<LineSegment>(midpoint);
                fixed_path.appendNew<LineSegment>(fixed_mirrorpath.initialPoint());
                break;
            }
            case LINECAP_SQUARE:
            {
                Geom::Point end_deriv = -unitTangentAt( reverse(pwd2_in.segs.back()), 0.);
                double radius = 0.5 * distance(fixed_path.finalPoint(), fixed_mirrorpath.initialPoint());
                fixed_path.appendNew<LineSegment>( fixed_path.finalPoint() + radius*end_deriv );
                fixed_path.appendNew<LineSegment>( fixed_mirrorpath.initialPoint() + radius*end_deriv );
                fixed_path.appendNew<LineSegment>( fixed_mirrorpath.initialPoint() );
                break;
            }
            case LINECAP_BUTT:
            {
                fixed_path.appendNew<LineSegment>( fixed_mirrorpath.initialPoint() );
                break;
            }
            case LINECAP_ROUND:
            default:
            {
                double radius1 = 0.5 * distance(fixed_path.finalPoint(), fixed_mirrorpath.initialPoint());
                fixed_path.appendNew<EllipticalArc>( radius1, radius1, M_PI/2., false, y.lastValue() < 0, fixed_mirrorpath.initialPoint() );
                break;
            }
        }

        fixed_path.append(fixed_mirrorpath);
        switch (start_linecap) {
            case LINECAP_ZERO_WIDTH:
                // do nothing
                break;
            case LINECAP_PEAK:
            {
                Geom::Point start_deriv = unitTangentAt( pwd2_in.segs.front(), 0.);
                double radius = 0.5 * distance(fixed_path.initialPoint(), fixed_mirrorpath.finalPoint());
                Geom::Point midpoint = 0.5*(fixed_mirrorpath.finalPoint() + fixed_path.initialPoint()) - radius*start_deriv;
                fixed_path.appendNew<LineSegment>( midpoint );
                fixed_path.appendNew<LineSegment>( fixed_path.initialPoint() );
                break;
            }
            case LINECAP_SQUARE:
            {
                Geom::Point start_deriv = unitTangentAt( pwd2_in.segs.front(), 0.);
                double radius = 0.5 * distance(fixed_path.initialPoint(), fixed_mirrorpath.finalPoint());
                fixed_path.appendNew<LineSegment>( fixed_mirrorpath.finalPoint() - radius*start_deriv );
                fixed_path.appendNew<LineSegment>( fixed_path.initialPoint() - radius*start_deriv );
                fixed_path.appendNew<LineSegment>( fixed_path.initialPoint() );
                break;
            }
            case LINECAP_BUTT:
            {
                fixed_path.appendNew<LineSegment>( fixed_path.initialPoint() );
                break;
            }
            case LINECAP_ROUND:
            default:
            {
                double radius2 = 0.5 * distance(fixed_path.initialPoint(), fixed_mirrorpath.finalPoint());
                fixed_path.appendNew<EllipticalArc>( radius2, radius2, M_PI/2., false, y.firstValue() < 0, fixed_path.initialPoint() );
                break;
            }
        }
        fixed_path.close(true);
        path_out.push_back(fixed_path);
    }
    return write_without_stitches(path_out);
}

} // namespace

EMSCRIPTEN_BINDINGS(lpe_powerstroke)
{
    emscripten::function("powerstrokePath", &powerstroke_path);
}
