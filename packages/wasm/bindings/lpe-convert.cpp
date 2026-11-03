// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for the geometry of the Join type and Dashed Stroke path effects (their
// doEffect_path copied from upstream, with the parameters passed in). The effects are ported to
// TypeScript (packages/core/src/live_effects). Geometry is SVG path data.
//
// Upstream: src/live_effects/lpe-jointype.cpp, src/live_effects/lpe-dashed-stroke.cpp
/*
 * Copyright (C) 2014 Authors (Join type)
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
#include <emscripten/bind.h>
#include <cmath>
#include <limits>
#include <2geom/path.h>
#include <2geom/pathvector.h>
#include <2geom/piecewise.h>
#include <2geom/sbasis-geometric.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include "helper/geom.h"
#include "helper/geom-pathstroke.h"

namespace {

/** LPEJoinType::doEffect_path. join is an Inkscape::LineJoinType, cap a LineCapType. */
std::string join_type_path(std::string const &d, double line_width, double miter_limit, bool attempt_force_join,
                           int join, int cap)
{
    Geom::PathVector const path_in = Geom::parse_svg_path(d.c_str());
    Geom::PathVector ret;
    for (const auto & i : path_in) {
        Geom::PathVector tmp = Inkscape::outline(i, line_width,
                                                 (attempt_force_join ? std::numeric_limits<double>::max() : miter_limit),
                                                 static_cast<Inkscape::LineJoinType>(join),
                                                 static_cast<Inkscape::LineCapType>(cap));
        ret.insert(ret.begin(), tmp.begin(), tmp.end());
    }
    return Geom::write_svg_path(ret);
}

/** The parameters of LPEDashedStroke, and its doEffect_path. */
struct DashedStroke
{
    double numberdashes;
    double holefactor;
    bool splitsegments;
    bool halfextreme;
    bool unifysegment;

    ///Calculate the time in curve_in with a real time of A
    //TODO: find a better place to it
    double timeAtLength(double const A, Geom::Path const &segment)
    {
        if ( A == 0 || segment[0].isDegenerate()) {
            return 0;
        }
        double t = 1;
        t = timeAtLength(A, segment.toPwSb());
        return t;
    }

    ///Calculate the time in curve_in with a real time of A
    //TODO: find a better place to it
    double timeAtLength(double const A, Geom::Piecewise<Geom::D2<Geom::SBasis>> pwd2)
    {
        if ( A == 0 || pwd2.size() == 0) {
            return 0;
        }

        double t = pwd2.size();
        std::vector<double> t_roots = roots(Geom::arcLengthSb(pwd2) - A);
        if (!t_roots.empty()) {
            t = t_roots[0];
        }
        return t;
    }

    Geom::PathVector doEffect_path(Geom::PathVector const &path_in)
    {
        Geom::PathVector const pv = pathv_to_linear_and_cubic_beziers(path_in);
        Geom::PathVector result;
        for (const auto & path_it : pv) {
            if (path_it.empty()) {
                continue;
            }
            Geom::Path::const_iterator curve_it1 = path_it.begin();
            Geom::Path::const_iterator curve_it2 = ++(path_it.begin());
            Geom::Path::const_iterator curve_endit = path_it.end_default();
            if (path_it.closed()) {
              const Geom::Curve &closingline = path_it.back_closed();
              // the closing line segment is always of type
              // Geom::LineSegment.
              if (are_near(closingline.initialPoint(), closingline.finalPoint())) {
                // closingline.isDegenerate() did not work, because it only checks for
                // *exact* zero length, which goes wrong for relative coordinates and
                // rounding errors...
                // the closing line segment has zero-length. So stop before that one!
                curve_endit = path_it.end_open();
              }
            }
            size_t numberdashes_fixed = numberdashes;
            if(!splitsegments) {
                numberdashes_fixed++;
            }
            size_t numberholes = numberdashes_fixed - 1;
            size_t ammount = numberdashes_fixed + numberholes;
            if (halfextreme) {
                ammount--;
            }
            double base = 1/(double)ammount;
            double globaldash =  base * numberdashes_fixed * (1 + holefactor);
            if (halfextreme) {
                globaldash =  base * (numberdashes_fixed - 1) * (1 + holefactor);
            }
            double globalhole =  1-globaldash;
            double dashpercent = globaldash/numberdashes_fixed;
            if (halfextreme) {
               dashpercent = globaldash/(numberdashes_fixed -1);
            }
            double holepercent = globalhole/numberholes;
            double dashsize_fixed = 0;
            double holesize_fixed = 0;
            Geom::Piecewise<Geom::D2<Geom::SBasis> > pwd2 = path_it.toPwSb();
            double length_pwd2 = length (pwd2);
            double minlength = length_pwd2;
            if(unifysegment) {
                while (curve_it1 != curve_endit) {
                    double length_segment = (*curve_it1).length();
                    if (length_segment < minlength) {
                        minlength = length_segment;
                        dashsize_fixed = (*curve_it1).length() * dashpercent;
                        holesize_fixed = (*curve_it1).length() * holepercent;
                    }
                    ++curve_it1;
                    ++curve_it2;
                }
                curve_it1 = path_it.begin();
                curve_it2 = ++(path_it.begin());
                curve_endit = path_it.end_default();
            }
            size_t p_index = 0;
            size_t start_index = result.size();
            if(splitsegments) {
                while (curve_it1 != curve_endit) {
                    Geom::Path segment = path_it.portion(p_index, p_index + 1);
                    if(unifysegment) {
                        double integral;
                        modf((*curve_it1).length()/(dashsize_fixed + holesize_fixed), &integral);
                        numberdashes_fixed = (size_t)integral + 1;
                        numberholes = numberdashes_fixed - 1;
                        ammount = numberdashes_fixed + numberholes;
                        if (halfextreme) {
                            ammount--;
                        }
                        base = 1/(double)ammount;
                        globaldash =  base * numberdashes_fixed * (1 + holefactor);
                        if (halfextreme) {
                            globaldash =  base * (numberdashes_fixed - 1) * (1 + holefactor);
                        }
                        globalhole =  1-globaldash;
                        dashpercent = globaldash/numberdashes_fixed;
                        if (halfextreme) {
                           dashpercent = globaldash/(numberdashes_fixed -1);
                        }
                        holepercent = globalhole/numberholes;
                    }
                    double dashsize = (*curve_it1).length() * dashpercent;
                    double holesize = (*curve_it1).length() * holepercent;
                    if ((*curve_it1).isLineSegment()) {
                        if (result.size() && Geom::are_near(segment.initialPoint(),result[result.size()-1].finalPoint())) {
                            result[result.size()-1].setFinal(segment.initialPoint());
                            if (halfextreme) {
                                result[result.size()-1].append(segment.portion(0.0, dashpercent/2.0));
                            } else {
                                result[result.size()-1].append(segment.portion(0.0, dashpercent));
                            }
                        } else {
                            if (halfextreme) {
                                result.push_back(segment.portion(0.0, dashpercent/2.0));
                            } else {
                                result.push_back(segment.portion(0.0, dashpercent));
                            }
                        }
                        double start = dashpercent + holepercent;
                        if (halfextreme) {
                            start = (dashpercent/2.0) + holepercent;
                        }
                        while (start  < 1) {
                            if (start + dashpercent > 1) {
                                result.push_back(segment.portion(start, 1));
                            } else {
                                result.push_back(segment.portion(start, start + dashpercent));
                            }
                            start += dashpercent + holepercent;
                        }
                    } else if (!(*curve_it1).isLineSegment()) {
                        double start = 0.0;
                        double end = 0.0;
                        if (halfextreme) {
                            end = timeAtLength(dashsize/2.0,segment);
                        } else {
                            end = timeAtLength(dashsize,segment);
                        }
                        if (result.size() && Geom::are_near(segment.initialPoint(),result[result.size()-1].finalPoint())) {
                            result[result.size()-1].setFinal(segment.initialPoint());
                            result[result.size()-1].append(segment.portion(start, end));
                        } else {
                            result.push_back(segment.portion(start, end));
                        }
                        double startsize = dashsize + holesize;
                        if (halfextreme) {
                            startsize = (dashsize/2.0) + holesize;
                        }
                        double endsize = startsize + dashsize;
                        start = timeAtLength(startsize,segment);
                        end   = timeAtLength(endsize,segment);
                        while (start  < 1 && start  > 0) {
                            result.push_back(segment.portion(start, end));
                            startsize = endsize + holesize;
                            endsize = startsize + dashsize;
                            start = timeAtLength(startsize,segment);
                            end   = timeAtLength(endsize,segment);
                        }
                    }
                    if (curve_it2 == curve_endit) {
                        if (path_it.closed()) {
                            Geom::Path end = result[result.size()-1];
                            end.setFinal(result[start_index].initialPoint());
                            end.append(result[start_index]);
                            result[start_index] = end;
                        }
                    }
                    p_index ++;
                    ++curve_it1;
                    ++curve_it2;
                }
            } else {
                double start = 0.0;
                double end = 0.0;
                double dashsize = length_pwd2 * dashpercent;
                double holesize = length_pwd2 * holepercent;
                if (halfextreme) {
                    end = timeAtLength(dashsize/2.0,pwd2);
                } else {
                    end = timeAtLength(dashsize,pwd2);
                }
                result.push_back(path_it.portion(start, end));
                double startsize = dashsize + holesize;
                if (halfextreme) {
                    startsize = (dashsize/2.0) + holesize;
                }
                double endsize = startsize + dashsize;
                start = timeAtLength(startsize,pwd2);
                end   = timeAtLength(endsize,pwd2);
                while (start  < path_it.size() && start  > 0) {
                    result.push_back(path_it.portion(start, end));
                    startsize = endsize + holesize;
                    endsize = startsize + dashsize;
                    start = timeAtLength(startsize,pwd2);
                    end   = timeAtLength(endsize,pwd2);
                }
                if (path_it.closed()) {
                    Geom::Path end = result[result.size()-1];
                    end.setFinal(result[start_index].initialPoint());
                    end.append(result[start_index]);
                    result[start_index] = end;
                }
            }
        }
        return result;
    }
};

std::string dashed_stroke_path(std::string const &d, double numberdashes, double holefactor, bool splitsegments,
                               bool halfextreme, bool unifysegment)
{
    DashedStroke e{numberdashes, holefactor, splitsegments, halfextreme, unifysegment};
    return Geom::write_svg_path(e.doEffect_path(Geom::parse_svg_path(d.c_str())));
}

} // namespace

EMSCRIPTEN_BINDINGS(lpe_convert)
{
    emscripten::function("joinTypePath", &join_type_path);
    emscripten::function("dashedStrokePath", &dashed_stroke_path);
}
