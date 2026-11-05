// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for the 2geom parts of more path effects: their doEffect_path / doEffect_pwd2
// (and helpers) copied from upstream, with the parameters passed in. The effects, their
// parameters and knots are ported to TypeScript (packages/core/src/live_effects).
// Geometry is SVG path data.
//
// Upstream: src/live_effects/lpe-recursiveskeleton.cpp, src/live_effects/lpe-extrude.cpp, src/live_effects/lpe-gears.cpp, src/live_effects/lpe-lattice.cpp, src/live_effects/lpe-lattice2.cpp, src/live_effects/lpe-rough-hatches.cpp, src/live_effects/lpe-dynastroke.cpp, src/live_effects/lpe-knot.cpp, src/live_effects/lpe-embrodery-stitch.cpp, src/live_effects/lpe-test-doEffect-stack.cpp, src/live_effects/lpe-attach-path.cpp, src/svg/svg-path.cpp
/*
 * Authors:
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *   Jean-Francois Barraud
 *   Steren Giannini
 *   Noé Falzon
 *   Victor Navez
 *   Jabiertxof
 *   Michael Soegtrop
 *
 * Copyright (C) 2007-2016 Authors
 */
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/basic-intersection.h>
#include <2geom/elliptical-arc.h>
#include <2geom/bezier-to-sbasis.h>
#include <2geom/path.h>
#include <2geom/pathvector.h>
#include <2geom/piecewise.h>
#include <2geom/sbasis-2d.h>
#include <2geom/sbasis-geometric.h>
#include <2geom/sbasis-math.h>
#include <2geom/sbasis-to-bezier.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include <algorithm>
#include <functional>
#include <map>
#include "helper/geom.h"
#include "live_effects/lpe-embrodery-stitch-ordering.h"

namespace {

using namespace Geom;
using Pwd2 = Piecewise<D2<SBasis>>;

constexpr double LPE_CONVERSION_TOLERANCE = 0.01; // effect.h

// Upstream: Effect::doEffect_path(): each path (or all, with concatenate) through the pwd2 function.
std::string apply_pwd2(std::string const &d, bool concatenate, std::function<Pwd2(Pwd2 const &)> const &f)
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

Point point_at(std::vector<double> const &v, size_t i)
{
    return Point(v.at(2 * i), v.at(2 * i + 1));
}

// ---------------------------------------------------------------------------------------------
// lpe-test-doEffect-stack.cpp: doEffect_pwd2 returns its input.

std::string identity_pwd2_path(std::string const &d)
{
    return apply_pwd2(d, false, [](Pwd2 const &pwd2_in) { return pwd2_in; });
}

// ---------------------------------------------------------------------------------------------
// lpe-recursiveskeleton.cpp: LPERecursiveSkeleton::doEffect_pwd2 (concatenate_before_pwd2).

std::string recursive_skeleton_path(std::string const &d, int iterations)
{
    return apply_pwd2(d, true, [&](Pwd2 const &pwd2_in) {
        Piecewise<D2<SBasis> > output;
        double prop_scale = 1.0;

        D2<Piecewise<SBasis> > patternd2 = make_cuts_independent(pwd2_in);
        Piecewise<SBasis> x0 = Piecewise<SBasis>(patternd2[0]);
        Piecewise<SBasis> y0 = Piecewise<SBasis>(patternd2[1]);
        OptInterval pattBndsX = bounds_exact(x0);
        OptInterval pattBndsY = bounds_exact(y0);

        if ( !pattBndsX || !pattBndsY) {
            return pwd2_in;
        }

        x0 -= pattBndsX->min();
        y0 -= pattBndsY->middle();

        double noffset = 0;//normal_offset;
        double toffset = 0;//tang_offset;

        y0+=noffset;

        output = pwd2_in;

        for (int i = 0; i < iterations; ++i) {
            std::vector<Piecewise<D2<SBasis> > > skeleton = split_at_discontinuities(output);

            output.clear();
            for (auto path_i : skeleton){
                Piecewise<SBasis> x = x0;
                Piecewise<SBasis> y = y0;
                Piecewise<D2<SBasis> > uskeleton = arc_length_parametrization(path_i,2,.1);
                uskeleton = remove_short_cuts(uskeleton,.01);
                Piecewise<D2<SBasis> > n = rot90(derivative(uskeleton));
                n = force_continuity(remove_short_cuts(n,.1));

                double scaling = (uskeleton.domain().extent() - toffset)/pattBndsX->extent();

                if (scaling != 1.0) {
                    x*=scaling;
                }
                y*=(scaling*prop_scale);
                x += toffset;

                output.concat(compose(uskeleton,x)+y*compose(n,x));
            }
        }
        return output;
    });
}

// ---------------------------------------------------------------------------------------------
// lpe-extrude.cpp: LPEExtrude::doEffect_pwd2 (case 1: closed subpaths for the faces).

bool are_colinear(Geom::Point a, Geom::Point b) {
    return Geom::are_near(cross(a,b), 0., 0.5);
}

// find cusps, except at start/end for closed paths.
std::vector<double> find_cusps( Geom::Piecewise<Geom::D2<Geom::SBasis> > const & pwd2_in ) {
    Piecewise<D2<SBasis> > deriv = derivative(pwd2_in);
    std::vector<double> cusps;
    // cusps are spots where the derivative jumps.
    for (unsigned i = 1 ; i < deriv.size() ; ++i) {
        if ( ! are_colinear(deriv[i-1].at1(), deriv[i].at0()) ) {
            // there is a jump in the derivative, so add it to the cusps list
            cusps.push_back(deriv.cuts[i]);
        }
    }
    return cusps;
}

std::string extrude_path(std::string const &d, double vx, double vy)
{
    Point const extrude_vector(vx, vy);
    return apply_pwd2(d, false, [&](Pwd2 const &pwd2_in) {
        // generate connecting lines (the 'sides' of the extrusion)
        Geom::Path path(Point(0.,0.));
        path.appendNew<Geom::LineSegment>( extrude_vector );
        Piecewise<D2<SBasis> > connector = path.toPwSb();

        Piecewise<D2<SBasis> > pwd2_out;

        // split input path in pieces between points where deriv == vector
        Piecewise<D2<SBasis> > deriv = derivative(pwd2_in);
        std::vector<double> rts = roots(dot(deriv, rot90(extrude_vector)));

        std::vector<double> cusps = find_cusps(pwd2_in);

        // see if we should treat the path as being closed.
        bool closed_path = false;
        if ( are_near(pwd2_in.firstValue(), pwd2_in.lastValue()) ) {
            // the path is closed, however if there is a cusp at the closing point, we should treat it as being an open path.
            if ( are_colinear(deriv.firstValue(), deriv.lastValue()) ) {
                // there is no jump in the derivative, so treat path as being closed
                closed_path = true;
            }
        }

        std::vector<double> connector_pts;
        if (rts.empty()) {
            connector_pts = cusps;
        } else if (cusps.empty()) {
            connector_pts = rts;
        } else {
            connector_pts = rts;
            connector_pts.insert(connector_pts.begin(), cusps.begin(), cusps.end());
            sort(connector_pts.begin(), connector_pts.end());
        }

        double portion_t = 0.;
        for (unsigned i = 0; i < connector_pts.size() ; ++i) {
            Piecewise<D2<SBasis> > cut = portion(pwd2_in, portion_t, connector_pts[i] );
            portion_t = connector_pts[i];
            if (closed_path && i == 0) {
                // if the path is closed, skip the first cut and add it to the last cut later
                continue;
            }
            Piecewise<D2<SBasis> > part = cut;
            part.continuousConcat(connector + cut.lastValue());
            part.continuousConcat(reverse(cut) + extrude_vector);
            part.continuousConcat(reverse(connector) + cut.firstValue());
            pwd2_out.concat( part );
        }
        if (closed_path) {
            Piecewise<D2<SBasis> > cut = portion(pwd2_in, portion_t, pwd2_in.domain().max() );
            cut.continuousConcat(portion(pwd2_in, pwd2_in.domain().min(), connector_pts[0] ));
            Piecewise<D2<SBasis> > part = cut;
            part.continuousConcat(connector + cut.lastValue());
            part.continuousConcat(reverse(cut) + extrude_vector);
            part.continuousConcat(reverse(connector) + cut.firstValue());
            pwd2_out.concat( part );
        } else if (!are_near(portion_t, pwd2_in.domain().max())) {
            Piecewise<D2<SBasis> > cut = portion(pwd2_in, portion_t, pwd2_in.domain().max() );
            Piecewise<D2<SBasis> > part = cut;
            part.continuousConcat(connector + cut.lastValue());
            part.continuousConcat(reverse(cut) + extrude_vector);
            part.continuousConcat(reverse(connector) + cut.firstValue());
            pwd2_out.concat( part );
        }

        return pwd2_out;
    });
}

// ---------------------------------------------------------------------------------------------
// lpe-gears.cpp: class Gear and LPEGears::doEffect_path.

class Gear {
public:
    // pitch circles touch on two properly meshed gears
    // all measurements are taken from the pitch circle
    double pitch_diameter() {return (_number_of_teeth * _module) / M_PI;}
    double pitch_radius() {return pitch_diameter() / 2.0;}
    void pitch_radius(double R) {_module = (2 * M_PI * R) / _number_of_teeth;}

    // base circle serves as the basis for the involute toothe profile
    double base_diameter() {return pitch_diameter() * cos(_pressure_angle);}
    double base_radius() {return base_diameter() / 2.0;}

    // diametrical pitch
    double diametrical_pitch() {return _number_of_teeth / pitch_diameter();}

    // height of the tooth above the pitch circle
    double addendum() {return 1.0 / diametrical_pitch();}
    // depth of the tooth below the pitch circle
    double dedendum() {return addendum() + _clearance;}

    // root circle specifies the bottom of the fillet between teeth
    double root_radius() {return pitch_radius() - dedendum();}
    double root_diameter() {return root_radius() * 2.0;}

    // outer circle is the outside diameter of the gear
    double outer_radius() {return pitch_radius() + addendum();}
    double outer_diameter() {return outer_radius() * 2.0;}

    // angle covered by the tooth on the pitch circle
    double tooth_thickness_angle() {return M_PI / _number_of_teeth;}

    Geom::Point centre() {return _centre;}
    void centre(Geom::Point c) {_centre = c;}

    double angle() {return _angle;}
    void angle(double a) {_angle = a;}

    int number_of_teeth() {return _number_of_teeth;}

    Geom::Path path();
    Gear spawn(Geom::Point p);

    Gear(int n, double m, double phi)
        : _number_of_teeth(n)
        , _pressure_angle(phi)
        , _module(m)
    {
    }
private:
    int _number_of_teeth;
    double _pressure_angle;
    double _module;
    double _clearance = 0.0;
    double _angle = 0.0;
    Geom::Point _centre;
    D2<SBasis> _involute(double start, double stop) {
        D2<SBasis> B;
        D2<SBasis> I;
        Linear bo = Linear(start,stop);

        B[0] = cos(bo,2);
        B[1] = sin(bo,2);

        I = B - Linear(0,1) * derivative(B);
        I = I*base_radius() + _centre;
        return I;
    }
    D2<SBasis> _arc(double start, double stop, double R) {
        D2<SBasis> B;
        Linear bo = Linear(start,stop);

        B[0] = cos(bo,2);
        B[1] = sin(bo,2);

        B = B*R + _centre;
        return B;
    }
    // angle of the base circle used to create the involute to a certain radius
    double involute_swath_angle(double R) {
        if (R <= base_radius()) return 0.0;
        return sqrt(R*R - base_radius()*base_radius())/base_radius();
    }

    // angle of the base circle between the origin of the involute and the intersection on another radius
    double involute_intersect_angle(double R) {
        if (R <= base_radius()) return 0.0;
        return (sqrt(R*R - base_radius()*base_radius())/base_radius()) - acos(base_radius()/R);
    }
};

void
makeContinuous(D2<SBasis> &a, Point const b) {
    for(unsigned d=0;d<2;d++)
        a[d][0][0] = b[d];
}

Geom::Path Gear::path() {
    Geom::Path pb;

    // angle covered by a full tooth and fillet
    double tooth_rotation = 2.0 * tooth_thickness_angle();
    // angle covered by an involute
    double involute_advance = involute_intersect_angle(outer_radius()) - involute_intersect_angle(root_radius());
    // angle covered by the tooth tip
    double tip_advance = tooth_thickness_angle() - (2 * (involute_intersect_angle(outer_radius()) - involute_intersect_angle(pitch_radius())));
    // angle covered by the toothe root
    double root_advance = (tooth_rotation - tip_advance) - (2.0 * involute_advance);
    // begin drawing the involute at t if the root circle is larger than the base circle
    double involute_t = involute_swath_angle(root_radius())/involute_swath_angle(outer_radius());

    //rewind angle to start drawing from the leading edge of the tooth
    double first_tooth_angle = _angle - ((0.5 * tip_advance) + involute_advance);

    Geom::Point prev;
    for (int i=0; i < _number_of_teeth; i++)
    {
        double cursor = first_tooth_angle + (i * tooth_rotation);

        D2<SBasis> leading_I = compose(_involute(cursor, cursor + involute_swath_angle(outer_radius())), Linear(involute_t,1));
        if(i != 0) makeContinuous(leading_I, prev);
        pb.append(SBasisCurve(leading_I));
        cursor += involute_advance;
        prev = leading_I.at1();

        D2<SBasis> tip = _arc(cursor, cursor+tip_advance, outer_radius());
        makeContinuous(tip, prev);
        pb.append(SBasisCurve(tip));
        cursor += tip_advance;
        prev = tip.at1();

        cursor += involute_advance;
        D2<SBasis> trailing_I = compose(_involute(cursor, cursor - involute_swath_angle(outer_radius())), Linear(1,involute_t));
        makeContinuous(trailing_I, prev);
        pb.append(SBasisCurve(trailing_I));
        prev = trailing_I.at1();

        if (base_radius() > root_radius()) {
            Geom::Point leading_start = trailing_I.at1();
            Geom::Point leading_end = (root_radius() * unit_vector(leading_start - _centre)) + _centre;
            prev = leading_end;
            pb.appendNew<LineSegment>(leading_end);
        }

        D2<SBasis> root = _arc(cursor, cursor+root_advance, root_radius());
        makeContinuous(root, prev);
        pb.append(SBasisCurve(root));
        //cursor += root_advance;
        prev = root.at1();

        if (base_radius() > root_radius()) {
            Geom::Point trailing_start = root.at1();
            Geom::Point trailing_end = (base_radius() * unit_vector(trailing_start - _centre)) + _centre;
            pb.appendNew<LineSegment>(trailing_end);
            prev = trailing_end;
        }
    }

    return pb;
}

Gear Gear::spawn(Geom::Point p) {
    double radius = Geom::distance(this->centre(), p) - this->pitch_radius();
    int N  = (int) floor( (radius / this->pitch_radius()) * this->number_of_teeth() );

    Gear gear(N, _module, _pressure_angle);
    gear.centre(p);

    double a = atan2(p - this->centre());
    double new_angle = 0.0;
    if (gear.number_of_teeth() % 2 == 0)
        new_angle -= gear.tooth_thickness_angle();
    new_angle -= (_angle) * (pitch_radius() / gear.pitch_radius());
    new_angle += (a) * (pitch_radius() / gear.pitch_radius());
    gear.angle(new_angle + a);
    return gear;
}

/**
 * Upstream sp_svg_write_curve (svg/svg-path.cpp): curves that are not lines, Beziers or arcs (here:
 * the SBasisCurves of Gears) are written as cubicbezierpath_from_sbasis(c->toSBasis(), 0.1).
 */
std::string write_as_svg_path(PathVector const &pv)
{
    PathVector out;
    for (auto const &path : pv) {
        Geom::Path p(path.initialPoint());
        for (auto it = path.begin(); it != path.end_open(); ++it) {
            if (dynamic_cast<BezierCurve const *>(&*it) || dynamic_cast<EllipticalArc const *>(&*it)) {
                p.append(*it);
            } else {
                Geom::Path sbasis_path = cubicbezierpath_from_sbasis(it->toSBasis(), 0.1);
                sbasis_path.setInitial(p.finalPoint());
                p.append(sbasis_path);
            }
        }
        p.close(path.closed());
        out.push_back(p);
    }
    return write_svg_path(out);
}

std::string gears_path(std::string const &d, int teeth, double phi, double min_radius)
{
    PathVector const path_in = parse_svg_path(d.c_str());
    Geom::PathVector path_out;
    if (path_in.empty()) {
        return "";
    }
    Geom::Path gearpath = path_in[0];

    Geom::Path::iterator it(gearpath.begin());
    if ( it == gearpath.end() ) return write_as_svg_path(path_out);

    Gear gear(teeth, 200.0, phi * M_PI / 180);
    Geom::Point gear_centre = (*it).finalPoint();
    gear.centre(gear_centre);
    gear.angle(atan2((*it).initialPoint() - gear_centre));

    ++it;
    if ( it == gearpath.end() ) return write_as_svg_path(path_out);
    double radius = Geom::distance(gear_centre, (*it).finalPoint());
    radius = radius < min_radius?min_radius:radius;
    gear.pitch_radius(radius);

    path_out.push_back( gear.path());

    for (++it; it != gearpath.end() ; ++it) {
        if (are_near((*it).initialPoint(), (*it).finalPoint())) {
            continue;
        }
        // iterate through Geom::Curve in path_in
        Gear gearnew = gear.spawn( (*it).finalPoint() );
        path_out.push_back( gearnew.path() );
        gear = gearnew;
    }
    return write_as_svg_path(path_out);
}

// ---------------------------------------------------------------------------------------------
// lpe-lattice.cpp, lpe-lattice2.cpp: doEffect_pwd2. handles are the grid points [x0, y0, ...] (16 for
// Lattice, 36 for Lattice 2 with the shared points repeated); bbox is [x0, x1, y0, y1].

void init_sb2(D2<SBasis2d> &sb2, unsigned n, std::vector<double> const &handles, Point origin, double width,
              double height)
{
    //Initialisation of the sb2
    for(unsigned dim = 0; dim < 2; dim++) {
        sb2[dim].us = n;
        sb2[dim].vs = n;
        const int depth = sb2[dim].us*sb2[dim].vs;
        sb2[dim].resize(depth, Linear2d(0));
    }
    // n = 2: thirds (Lattice), n = 3: quarters (Lattice 2)
    double const parts = n + 1;
    for(unsigned dim = 0; dim < 2; dim++) {
        Geom::Point dir(0,0);
        dir[dim] = 1;
        for(unsigned vi = 0; vi < sb2[dim].vs; vi++) {
            for(unsigned ui = 0; ui < sb2[dim].us; ui++) {
                for(unsigned iv = 0; iv < 2; iv++) {
                    for(unsigned iu = 0; iu < 2; iu++) {
                        unsigned corner = iu + 2*iv;
                        unsigned i = ui + vi*sb2[dim].us;

                        //This is the offset from the Upperleft point
                        Geom::Point base(   (ui + iu*(parts-2*ui))*width/parts,
                                            (vi + iv*(parts-2*vi))*height/parts);

                        //Special action for corners
                        if(vi == 0 && ui == 0) {
                            base = Geom::Point(0,0);
                        }

                        // i = Upperleft corner of the considerated rectangle
                        // corner = actual corner of the rectangle
                        // origin = Upperleft point
                        double dl = dot((point_at(handles, corner+4*i) - (base + origin)), dir)/dot(dir,dir);
                        sb2[dim][i][corner] = dl/( dim ? height : width )*pow(4.0,ui+vi);
                    }
                }
            }
        }
    }
}

std::string lattice_path(std::string const &d, emscripten::val handles_js, double x0, double x1, double y0, double y1)
{
    auto const handles = emscripten::vecFromJSArray<double>(handles_js);
    Interval const boundingbox_X(x0, x1);
    Interval const boundingbox_Y(y0, y1);
    return apply_pwd2(d, false, [&](Pwd2 const &pwd2_in) {
        D2<SBasis2d> sb2;
        Geom::Point origin = Geom::Point(boundingbox_X.min(),boundingbox_Y.min());
        double width = boundingbox_X.extent();
        double height = boundingbox_Y.extent();
        init_sb2(sb2, 2, handles, origin, width, height);

        Piecewise<D2<SBasis> >  output;
        output.push_cut(0.);
        for(unsigned i = 0; i < pwd2_in.size(); i++) {
            D2<SBasis> B = pwd2_in[i];
            B -= origin;
            B*= 1/width;
            //Here comes the magic
            D2<SBasis> tB = compose_each(sb2,B);
            tB = tB * width + origin;

            output.push(tB,i+1);
        }
        return output;
    });
}

std::string lattice2_path(std::string const &d, emscripten::val handles_js, double x0, double x1, double y0, double y1)
{
    auto const handles = emscripten::vecFromJSArray<double>(handles_js);
    Interval const boundingbox_X(x0, x1);
    Interval const boundingbox_Y(y0, y1);
    return apply_pwd2(d, false, [&](Pwd2 const &pwd2_in) {
        PathVector pathv = path_from_piecewise(pwd2_in,0.001);
        //this is because strange problems with sb2 and LineSegment
        PathVector cubic = pathv_to_cubicbezier(pathv, true);
        if (cubic.empty()) {
            return pwd2_in;
        }
        Geom::Piecewise<Geom::D2<Geom::SBasis> > const &pwd2_in_linear_and_cubic = paths_to_pw(cubic);
        D2<SBasis2d> sb2;
        Geom::Point origin = Geom::Point(boundingbox_X.min(),boundingbox_Y.min());
        double width = boundingbox_X.extent();
        double height = boundingbox_Y.extent();
        init_sb2(sb2, 3, handles, origin, width, height);

        Piecewise<D2<SBasis> >  output;
        output.push_cut(0.);
        for(unsigned i = 0; i < pwd2_in_linear_and_cubic.size(); i++) {
            D2<SBasis> B = pwd2_in_linear_and_cubic[i];
            B[Geom::X] -= origin[Geom::X];
            B[Geom::X]*= 1/width;
            B[Geom::Y] -= origin[Geom::Y];
            B[Geom::Y]*= 1/height;
            //Here comes the magic
            D2<SBasis> tB = compose_each(sb2,B);
            tB[Geom::X] = tB[Geom::X] * width + origin[Geom::X];
            tB[Geom::Y] = tB[Geom::Y] * height + origin[Geom::Y];

            output.push(tB,i+1);
        }
        return output;
    });
}

// ---------------------------------------------------------------------------------------------
// lpe-rough-hatches.cpp

//------------------------------------------------
// Some goodies to navigate through curve's levels.
//------------------------------------------------
struct LevelCrossing{
    Point pt;
    double t;
    bool sign;
    bool used;
    std::pair<unsigned,unsigned> next_on_curve;
    std::pair<unsigned,unsigned> prev_on_curve;
};
struct LevelCrossingOrder {
    bool operator()(LevelCrossing a, LevelCrossing b) {
        return ( a.pt[Y] < b.pt[Y] );// a.pt[X] == b.pt[X] since we are supposed to be on the same level...
    }
};
struct LevelCrossingInfo{
    double t;
    unsigned level;
    unsigned idx;
};
struct LevelCrossingInfoOrder {
    bool operator()(LevelCrossingInfo a, LevelCrossingInfo b) {
        return a.t < b.t;
    }
};

typedef std::vector<LevelCrossing> LevelCrossings;

std::vector<double>
discontinuities(Piecewise<D2<SBasis> > const &f){
    std::vector<double> result;
    if (f.size()==0) return result;
    result.push_back(f.cuts[0]);
    Point prev_pt = f.segs[0].at1();
    for(unsigned i=1; i<f.size(); i++){
        if ( f.segs[i].at0()!=prev_pt){
            result.push_back(f.cuts[i]);
        }
        prev_pt = f.segs[i].at1();
    }
    result.push_back(f.cuts.back());
    return result;
}

class LevelsCrossings: public std::vector<LevelCrossings>{
public:
    LevelsCrossings():std::vector<LevelCrossings>(){};
    LevelsCrossings(std::vector<std::vector<double> > const &times,
                    Piecewise<D2<SBasis> > const &f,
                    Piecewise<SBasis> const &dx){

        for (const auto & time : times){
            LevelCrossings lcs;
            for (double j : time){
                LevelCrossing lc;
                lc.pt = f.valueAt(j);
                lc.t = j;
                lc.sign = ( dx.valueAt(j)>0 );
                lc.used = false;
                lcs.push_back(lc);
            }
            std::sort(lcs.begin(), lcs.end(), LevelCrossingOrder());
            push_back(lcs);
        }
        //Now create time ordering.
        std::vector<LevelCrossingInfo>temp;
        for (unsigned i=0; i<size(); i++){
            for (unsigned j=0; j<(*this)[i].size(); j++){
                LevelCrossingInfo elem;
                elem.t = (*this)[i][j].t;
                elem.level = i;
                elem.idx = j;
                temp.push_back(elem);
            }
        }
        std::sort(temp.begin(),temp.end(),LevelCrossingInfoOrder());
        std::vector<double> jumps = discontinuities(f);
        unsigned jump_idx = 0;
        unsigned first_in_comp = 0;
        for (unsigned i=0; i<temp.size(); i++){
            unsigned lvl = temp[i].level, idx = temp[i].idx;
            if ( i == temp.size()-1 || temp[i+1].t > jumps[jump_idx+1]){
                std::pair<unsigned,unsigned>next_data(temp[first_in_comp].level,temp[first_in_comp].idx);
                (*this)[lvl][idx].next_on_curve = next_data;
                first_in_comp = i+1;
                jump_idx += 1;
            }else{
                std::pair<unsigned,unsigned> next_data(temp[i+1].level,temp[i+1].idx);
                (*this)[lvl][idx].next_on_curve = next_data;
            }
        }

        for (unsigned i=0; i<size(); i++){
            for (unsigned j=0; j<(*this)[i].size(); j++){
                std::pair<unsigned,unsigned> next = (*this)[i][j].next_on_curve;
                (*this)[next.first][next.second].prev_on_curve = std::pair<unsigned,unsigned>(i,j);
            }
        }
    }

    void findFirstUnused(unsigned &level, unsigned &idx){
        level = size();
        idx = 0;
        for (unsigned i=0; i<size(); i++){
            for (unsigned j=0; j<(*this)[i].size(); j++){
                if (!(*this)[i][j].used){
                    level = i;
                    idx = j;
                    return;
                }
            }
        }
    }
    //set indexes to point to the next point in the "snake walk"
    //follow_level's meaning:
    //  0=yes upward
    //  1=no, last move was upward,
    //  2=yes downward
    //  3=no, last move was downward.
    void step(unsigned &level, unsigned &idx, int &direction){
        if ( direction % 2 == 0 ){
            if (direction == 0) {
                if ( idx >= (*this)[level].size()-1 || (*this)[level][idx+1].used ) {
                    level = size();
                    return;
                }
                idx += 1;
            }else{
                if ( idx <= 0  || (*this)[level][idx-1].used ) {
                    level = size();
                    return;
                }
                idx -= 1;
            }
            direction += 1;
            return;
        }
        double sign = ((*this)[level][idx].sign ? 1 : -1);
        direction = (direction + 1)%4;
        if (level == size()){
            return;
        }

        std::pair<unsigned,unsigned> next;
        if ( sign > 0 ){
            next = (*this)[level][idx].next_on_curve;
        }else{
            next = (*this)[level][idx].prev_on_curve;
        }

        if ( level+1 != next.first || (*this)[next.first][next.second].used ) {
            level = size();
            return;
        }
        level = next.first;
        idx = next.second;
        return;
    }
};

//-------------------------------------------------------
// Bend a path...
//-------------------------------------------------------

Piecewise<D2<SBasis> > bend(Piecewise<D2<SBasis> > const &f, Piecewise<SBasis> bending){
    D2<Piecewise<SBasis> > ff = make_cuts_independent(f);
    ff[X] += compose(bending, ff[Y]);
    return sectionize(ff);
}

/**
 * The parameters of LPERoughHatches. A RandomParam gives a new random number each time the
 * upstream code reads it as a double (R); get_value() is V. The random numbers come from the
 * TypeScript parameters, so the sequence is the same as upstream.
 */
struct RoughHatches
{
    enum Rnd { DIST_RDM, TOP_EDGE_VARIATION, BOT_EDGE_VARIATION, TOP_TGT_VARIATION, BOT_TGT_VARIATION,
               TOP_SMTH_VARIATION, BOT_SMTH_VARIATION };
    emscripten::val rnd;    // rnd(k): the next random number of RandomParam k
    std::vector<double> v;  // v[k]: get_value() of RandomParam k
    double hatch_dist = 0;
    double growth;
    double scale_tf, scale_tb, scale_bf, scale_bb;
    bool fat_output;
    bool do_bend;
    double stroke_width_top, stroke_width_bot;
    double front_thickness, back_thickness;
    Point direction_origin, direction_vector;
    Point bender_vector;

    double R(Rnd k) const { return rnd(static_cast<int>(k)).as<double>(); }
    double V(Rnd k) const { return v.at(k); }

    Piecewise<D2<SBasis> > doEffect_pwd2 (Piecewise<D2<SBasis> > const & pwd2_in){

        Piecewise<D2<SBasis> > result;

        Piecewise<D2<SBasis> > transformed_pwd2_in = pwd2_in;
        Point start = pwd2_in.segs.front().at0();
        Point end = pwd2_in.segs.back().at1();
        if (end != start ){
            transformed_pwd2_in.push_cut( transformed_pwd2_in.cuts.back() + 1 );
            D2<SBasis> stitch( SBasis( 1, Linear(end[X],start[X]) ), SBasis( 1, Linear(end[Y],start[Y]) ) );
            transformed_pwd2_in.push_seg( stitch );
        }
        Point transformed_org = direction_origin;
        Piecewise<SBasis> tilter;//used to bend the hatches
        Affine bend_mat;//used to bend the hatches

        if (do_bend){
            Point bend_dir = -rot90(unit_vector(bender_vector));
            double bend_amount = L2(bender_vector);
            bend_mat = Affine(-bend_dir[Y], bend_dir[X], bend_dir[X], bend_dir[Y],0,0);
            transformed_pwd2_in = transformed_pwd2_in * bend_mat;
            tilter = Piecewise<SBasis>(shift(Linear(-bend_amount),1));
            OptRect bbox = bounds_exact( transformed_pwd2_in );
            if (!(bbox)) return pwd2_in;
            tilter.setDomain((*bbox)[Y]);
            transformed_pwd2_in = bend(transformed_pwd2_in, tilter);
            transformed_pwd2_in = transformed_pwd2_in * bend_mat.inverse();
        }
        hatch_dist = Geom::L2(direction_vector)/5;
        Point hatches_dir = rot90(unit_vector(direction_vector));
        Affine mat(-hatches_dir[Y], hatches_dir[X], hatches_dir[X], hatches_dir[Y],0,0);
        transformed_pwd2_in = transformed_pwd2_in * mat;
        transformed_org *= mat;

        std::vector<std::vector<Point> > snakePoints;
        snakePoints = linearSnake(transformed_pwd2_in, transformed_org);
        if (!snakePoints.empty()){
            Piecewise<D2<SBasis> >smthSnake = smoothSnake(snakePoints);
            smthSnake = smthSnake*mat.inverse();
            if (do_bend){
                smthSnake = smthSnake*bend_mat;
                smthSnake = bend(smthSnake, -tilter);
                smthSnake = smthSnake*bend_mat.inverse();
            }
            return (smthSnake);
        }
        return pwd2_in;
    }

    //------------------------------------------------
    // Generate the levels with random, growth...
    //------------------------------------------------
    std::vector<double>
    generateLevels(Interval const &domain, double x_org){
        std::vector<double> result;
        int n = int((domain.min()-x_org)/hatch_dist);
        double x = x_org +  n * hatch_dist;
        double step = double(hatch_dist);
        double scale = 1+(hatch_dist*growth/domain.extent());
        while (x < domain.max()){
            result.push_back(x);
            double rdm = 1;
            if (V(DIST_RDM) != 0)
                rdm = 1.+ double((2*R(DIST_RDM) - V(DIST_RDM)))/100.;
            x+= step*rdm;
            step*=scale;//(1.+double(growth));
        }
        return result;
    }

    //-------------------------------------------------------
    // Walk through the intersections to create linear hatches
    //-------------------------------------------------------
    std::vector<std::vector<Point> >
    linearSnake(Piecewise<D2<SBasis> > const &f, Point const &org){

        std::vector<std::vector<Point> > result;
        Piecewise<SBasis> x = make_cuts_independent(f)[X];
        //Remark: derivative is computed twice in the 2 lines below!!
        Piecewise<SBasis> dx = derivative(x);
        OptInterval range = bounds_exact(x);

        if (!range) return result;
        std::vector<double> levels = generateLevels(*range, org[X]);
        std::vector<std::vector<double> > times;
        times = multi_roots(x,levels);
    //TODO: fix multi_roots!!!*****************************************
    //remove doubles :-(
        std::vector<std::vector<double> > cleaned_times(levels.size(),std::vector<double>());
        for (unsigned i=0; i<times.size(); i++){
            if ( times[i].size()>0 ){
                double last_t = times[i][0]-1;//ugly hack!!
                for (unsigned j=0; j<times[i].size(); j++){
                    if (times[i][j]-last_t >0.000001){
                        last_t = times[i][j];
                        cleaned_times[i].push_back(last_t);
                    }
                }
            }
        }
        times = cleaned_times;
    //*******************************************************************

        LevelsCrossings lscs(times,f,dx);

        unsigned i,j;
        lscs.findFirstUnused(i,j);

        std::vector<Point> result_component;
        int n = int((range->min()-org[X])/hatch_dist);

        while ( i < lscs.size() ){
            int dir = 0;
            //switch orientation of first segment according to starting point.
            if ((static_cast<long long>(i) % 2 == n % 2) && ((j + 1) < lscs[i].size()) && !lscs[i][j].used){
                j += 1;
                dir = 2;
            }

            while ( i < lscs.size() ){
                result_component.push_back(lscs[i][j].pt);
                lscs[i][j].used = true;
                lscs.step(i,j, dir);
            }
            result.push_back(result_component);
            result_component = std::vector<Point>();
            lscs.findFirstUnused(i,j);
        }
        return result;
    }

    //-------------------------------------------------------
    // Smooth the linear hatches according to params...
    //-------------------------------------------------------
    Piecewise<D2<SBasis> >
    smoothSnake(std::vector<std::vector<Point> > const &linearSnake){

        Piecewise<D2<SBasis> > result;
        for (const auto & comp : linearSnake){
            if (comp.size()>=2){
                Point last_pt = comp[0];
                Point last_hdle = comp[0];
                Point last_top_hdle = comp[0];
                Point last_bot_hdle = comp[0];
                Geom::Path res_comp(last_pt);
                Geom::Path res_comp_top(last_pt);
                Geom::Path res_comp_bot(last_pt);
                unsigned i=1;
                //bool is_top = true;//Inversion here; due to downward y?
                bool is_top = ( comp[0][Y] < comp[1][Y] );

                while( i+1<comp.size() ){
                    Point pt0 = comp[i];
                    Point pt1 = comp[i+1];
                    Point new_pt = (pt0+pt1)/2;
                    double scale_in = (is_top ? scale_tf : scale_bf );
                    double scale_out = (is_top ? scale_tb : scale_bb );
                    if (is_top){
                        if (V(TOP_EDGE_VARIATION) != 0)
                            new_pt[Y] += R(TOP_EDGE_VARIATION)-V(TOP_EDGE_VARIATION)/2.;
                        if (V(TOP_TGT_VARIATION) != 0)
                            new_pt[X] += R(TOP_TGT_VARIATION)-V(TOP_TGT_VARIATION)/2.;
                        if (V(TOP_SMTH_VARIATION) != 0) {
                            scale_in*=(100.-R(TOP_SMTH_VARIATION))/100.;
                            scale_out*=(100.-R(TOP_SMTH_VARIATION))/100.;
                        }
                    }else{
                        if (V(BOT_EDGE_VARIATION) != 0)
                            new_pt[Y] += R(BOT_EDGE_VARIATION)-V(BOT_EDGE_VARIATION)/2.;
                        if (V(BOT_TGT_VARIATION) != 0)
                            new_pt[X] += R(BOT_TGT_VARIATION)-V(BOT_TGT_VARIATION)/2.;
                        if (V(BOT_SMTH_VARIATION) != 0) {
                            scale_in*=(100.-R(BOT_SMTH_VARIATION))/100.;
                            scale_out*=(100.-R(BOT_SMTH_VARIATION))/100.;
                        }
                    }
                    Point new_hdle_in  = new_pt + (pt0-pt1) * (scale_in /2.);
                    Point new_hdle_out = new_pt - (pt0-pt1) * (scale_out/2.);

                    if ( fat_output ){
                        Point inside = new_pt;
                        Point inside_hdle_in;
                        Point inside_hdle_out;
                        inside[Y]+= double((is_top ? -stroke_width_top : stroke_width_bot));
                        inside_hdle_in  = inside + (new_hdle_in -new_pt);
                        inside_hdle_out = inside + (new_hdle_out-new_pt);

                        inside_hdle_in  +=  (pt1-pt0)/2*( double((is_top ? front_thickness : back_thickness)) / (pt1[X]-pt0[X]) );
                        inside_hdle_out -=  (pt1-pt0)/2*( double((is_top ? back_thickness : front_thickness)) / (pt1[X]-pt0[X]) );

                        new_hdle_in  -=  (pt1-pt0)/2*( double((is_top ? front_thickness : back_thickness)) / (pt1[X]-pt0[X]) );
                        new_hdle_out +=  (pt1-pt0)/2*( double((is_top ? back_thickness : front_thickness)) / (pt1[X]-pt0[X]) );

                        if (is_top){
                            res_comp_top.appendNew<CubicBezier>(last_top_hdle,new_hdle_in,new_pt);
                            res_comp_bot.appendNew<CubicBezier>(last_bot_hdle,inside_hdle_in,inside);
                            last_top_hdle = new_hdle_out;
                            last_bot_hdle = inside_hdle_out;
                        }else{
                            res_comp_top.appendNew<CubicBezier>(last_top_hdle,inside_hdle_in,inside);
                            res_comp_bot.appendNew<CubicBezier>(last_bot_hdle,new_hdle_in,new_pt);
                            last_top_hdle = inside_hdle_out;
                            last_bot_hdle = new_hdle_out;
                        }
                    }else{
                        res_comp.appendNew<CubicBezier>(last_hdle,new_hdle_in,new_pt);
                    }

                    last_hdle = new_hdle_out;
                    i+=2;
                    is_top = !is_top;
                }
                if ( i<comp.size() ){
                    if ( fat_output ){
                        res_comp_top.appendNew<CubicBezier>(last_top_hdle,comp[i],comp[i]);
                        res_comp_bot.appendNew<CubicBezier>(last_bot_hdle,comp[i],comp[i]);
                    }else{
                        res_comp.appendNew<CubicBezier>(last_hdle,comp[i],comp[i]);
                    }
                }
                if ( fat_output ){
                    res_comp = res_comp_bot;
                    res_comp.setStitching(true);
                    res_comp.append(res_comp_top.reversed());
                }
                result.concat(res_comp.toPwSb());
            }
        }
        return result;
    }
};

/**
 * LPERoughHatches with Effect::doEffect_path. values: get_value() of the random parameters (see
 * RoughHatches::Rnd); p: the other parameters by name.
 */
std::string rough_hatches_path(std::string const &d, emscripten::val rnd, emscripten::val values, emscripten::val p)
{
    RoughHatches rh{rnd, emscripten::vecFromJSArray<double>(values)};
    rh.growth = p["growth"].as<double>();
    rh.scale_tf = p["scale_tf"].as<double>();
    rh.scale_tb = p["scale_tb"].as<double>();
    rh.scale_bf = p["scale_bf"].as<double>();
    rh.scale_bb = p["scale_bb"].as<double>();
    rh.fat_output = p["fat_output"].as<bool>();
    rh.do_bend = p["do_bend"].as<bool>();
    rh.stroke_width_top = p["stroke_width_top"].as<double>();
    rh.stroke_width_bot = p["stroke_width_bot"].as<double>();
    rh.front_thickness = p["front_thickness"].as<double>();
    rh.back_thickness = p["back_thickness"].as<double>();
    auto const dir = emscripten::vecFromJSArray<double>(p["direction"]);
    rh.direction_origin = Point(dir.at(0), dir.at(1));
    rh.direction_vector = Point(dir.at(2), dir.at(3));
    auto const bender = emscripten::vecFromJSArray<double>(p["bender"]);
    rh.bender_vector = Point(bender.at(0), bender.at(1));
    return apply_pwd2(d, false, [&](Pwd2 const &pwd2_in) { return rh.doEffect_pwd2(pwd2_in); });
}

// ---------------------------------------------------------------------------------------------
// lpe-dynastroke.cpp: LPEDynastroke::doEffect_pwd2. method and caps as DynastrokeMethod and
// DynastrokeCappingType.

enum DynastrokeMethod { DSM_ELLIPTIC_PEN = 0, DSM_THICKTHIN_FAST, DSM_THICKTHIN_SLOW };
enum DynastrokeCappingType { DSCT_SHARP = 0, DSCT_ROUND };

std::string dynastroke_path(std::string const &d, int method, double width, double roundness, double angle,
                            int start_cap, int end_cap, double growfor, double fadefor)
{
    return apply_pwd2(d, false, [&](Pwd2 const &pwd2_in) {
        Piecewise<D2<SBasis> > output;
        Piecewise<D2<SBasis> > m = pwd2_in;
        Piecewise<D2<SBasis> > v = derivative(m);;
        Piecewise<D2<SBasis> > n = unitVector(v);
        n = rot90(n);
        Piecewise<D2<SBasis> > n1,n2;

        double angle_rad = angle*M_PI/180.;//TODO: revert orientation?...
        Piecewise<SBasis> w;

        DynastrokeMethod stroke_method = static_cast<DynastrokeMethod>(method);
        if (roundness==1.) {
            n1 = n*double(width);
            n2 =-n1;
        }else{
            switch(stroke_method) {
                case DSM_ELLIPTIC_PEN:{
                    //FIXME: roundness=0???
                    double c = cos(angle_rad), s = sin(angle_rad);
                    Affine rot,slant;
                    rot = Affine(c, -s, s,  c, 0, 0 );
                    slant = Affine(double(width)*roundness, 0, 0,  double(width), 0, 0 );
                    Piecewise<D2<SBasis> > nn = unitVector(v * ( rot * slant ) );
                    slant = Affine( 0,-roundness, 1, 0, 0, 0 );
                    rot = Affine(-s, -c, c, -s, 0, 0 );
                    nn = nn * (slant * rot );

                    n1 = nn*double(width);
                    n2 =-n1;
                    break;
                }
                case DSM_THICKTHIN_FAST:{
                    D2<Piecewise<SBasis> > n_xy = make_cuts_independent(n);
                    w = n_xy[X]*sin(angle_rad) - n_xy[Y]*cos(angle_rad);
                    w = w * ((1 - roundness)*width/2.) + ((1 + roundness)*width/2.);
                    n1 = w*n;
                    n2 = -n1;
                    break;
                }
                case DSM_THICKTHIN_SLOW:{
                    D2<Piecewise<SBasis> > n_xy = make_cuts_independent(n);
                    w = n_xy[X]*cos(angle_rad)+ n_xy[Y]*sin(angle_rad);
                    w = w * ((1 - roundness)*width/2.) + ((1 + roundness)*width/2.);
                    //->Slower and less stable, but more accurate .
                    //  General  formula:  n1 = w*u with ||u||=1 and u.v = -dw/dt
                    Piecewise<SBasis> dw = derivative(w);
                    Piecewise<SBasis> ncomp = sqrt(dot(v,v)-dw*dw,.1,3);
                    //FIXME: is force continuity useful? compatible with corners?
                    n1 = -dw*v + ncomp*rot90(v);
                    n1 = w*force_continuity(unitVector(n1),.1);
                    n2 = -dw*v - ncomp*rot90(v);
                    n2 = w*force_continuity(unitVector(n2),.1);
                    break;
                }
                default:{
                    n1 = n*double(width);
                    n2 = n1*(-.5);
                    break;
                }
            }//case
        }//if/else

        //
        //TODO: insert relevant stitch at each corner!!
        //

        Piecewise<D2<SBasis> > left, right;
        if ( m.segs.front().at0() == m.segs.back().at1()){
            // if closed:
            left  = m + n1;//+ n;
            right = m + n2;//- n;
        } else {
            //if not closed, shape the ends:
            //TODO: allow fancy ends...
            double grow_length = growfor;// * width;
            double fade_length = fadefor;// * width;
            Piecewise<SBasis > s = arcLengthSb(m);
            double totlength = s.segs.back().at1();

            //scale factor for a sharp start
            SBasis join = SBasis(2,Linear(0,1));
            join[1] = Linear(1,1);
            Piecewise<SBasis > factor_in = Piecewise<SBasis >(join);
            factor_in.cuts[1]=grow_length;
            if (grow_length < totlength){
                factor_in.concat(Piecewise<SBasis >(Linear(1)));
                factor_in.cuts[2]=totlength;
            }
            //scale factor for a sharp end
            join[0] = Linear(1,0);
            join[1] = Linear(1,1);
            Piecewise<SBasis > factor_out;
            if (fade_length < totlength){
                factor_out = Piecewise<SBasis >(Linear(1));
                factor_out.cuts[1] = totlength-fade_length;
                factor_out.concat(Piecewise<SBasis >(join));
                factor_out.cuts[2] = totlength;
            }else{
                factor_out = Piecewise<SBasis >(join);
                factor_out.setDomain(Interval(totlength-fade_length,totlength));
            }

            Piecewise<SBasis > factor = factor_in*factor_out;
            n1 = compose(factor,s)*n1;
            n2 = compose(factor,s)*n2;

            left  = m + n1;
            right = m + n2;

            if (start_cap == DSCT_ROUND){
                SBasis tau(2,Linear(0));
                tau[1] = Linear(-1,0);
                Piecewise<SBasis > hbump;
                hbump.concat(Piecewise<SBasis >(tau*grow_length));
                hbump.concat(Piecewise<SBasis >(Linear(0)));
                hbump.cuts[0]=0;
                hbump.cuts[1]=fmin(grow_length,totlength*grow_length/(grow_length+fade_length));
                hbump.cuts[2]=totlength;
                hbump = compose(hbump,s);

                left  += - hbump * rot90(n);
                right += - hbump * rot90(n);
            }
            if (end_cap == DSCT_ROUND){
                SBasis tau(2,Linear(0));
                tau[1] = Linear(0,1);
                Piecewise<SBasis > hbump;
                hbump.concat(Piecewise<SBasis >(Linear(0)));
                hbump.concat(Piecewise<SBasis >(tau*fade_length));
                hbump.cuts[0]=0;
                hbump.cuts[1]=fmax(totlength-fade_length, totlength*grow_length/(grow_length+fade_length));
                hbump.cuts[2]=totlength;
                hbump = compose(hbump,s);

                left  += - hbump * rot90(n);
                right += - hbump * rot90(n);
            }
        }

        left = force_continuity(left);
        right = force_continuity(right);

        output = left;
        output.concat(reverse(right));
        return output;
    });
}

// ---------------------------------------------------------------------------------------------
// lpe-knot.cpp: the crossings (LPEKnotNS::CrossingPoints) and the gaps of one path component
// (the loop body of LPEKnot::doEffect_path). The crossings are 9 numbers each, as stored in the
// crossing_points_vector parameter: x, y, i, j, ni, nj, ti, tj, sign.

Geom::Path::size_type size_nondegenerate(Geom::Path const &path) {
    Geom::Path::size_type retval = path.size_default();
    // retval == 0 means the path only contains a closing line
    if (retval > 0) {
        Geom::Curve const &closingline = path.back_closed();
        // the closing line segment is always of type
        // Geom::LineSegment.
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) {
            // closingline.isDegenerate() did not work, because it only checks for
            // *exact* zero length, which goes wrong for relative coordinates and
            // rounding errors...
            // the closing line segment has zero-length. So stop before that one!
            retval = path.size_open();
        }
    }
    return retval;
}

//remove an interval from an union of intervals.
std::vector<Geom::Interval> complementOf(Geom::Interval I, std::vector<Geom::Interval> domain){
    std::vector<Geom::Interval> ret;
    if (!domain.empty()) {
        double min = domain.front().min();
        double max = domain.back().max();
        Geom::Interval I1 = Geom::Interval(min,I.min());
        Geom::Interval I2 = Geom::Interval(I.max(),max);

        for (auto i : domain){
            std::optional<Geom::Interval> I1i = intersect(i,I1);
            if (I1i && !I1i->isSingular()) ret.push_back(*I1i);
            std::optional<Geom::Interval> I2i = intersect(i,I2);
            if (I2i && !I2i->isSingular()) ret.push_back(*I2i);
        }
    }
    return ret;
}

//find the time interval during which patha is hidden by pathb near a given crossing.
// Warning: not accurate!
Geom::Interval
findShadowedTime(Geom::Path const &patha, std::vector<Geom::Point> const &pt_and_dir,
                 double const ta, double const width){
    Point T = unit_vector(pt_and_dir[1]);
    Point N = T.cw();

    Affine mat = from_basis( T, N, pt_and_dir[0] );
    mat = mat.inverse();
    Geom::Path p = patha * mat;

    std::vector<double> times;

    //TODO: explore the path fwd/backward from ta (worth?)
    for (unsigned i = 0; i < size_nondegenerate(patha); i++){
        D2<SBasis> f = p[i].toSBasis();
        std::vector<double> times_i, temptimes;
        temptimes = roots(f[Y]-width);
        times_i.insert(times_i.end(), temptimes.begin(), temptimes.end() );
        temptimes = roots(f[Y]+width);
        times_i.insert(times_i.end(), temptimes.begin(), temptimes.end() );
        temptimes = roots(f[X]-3*(width?width:EPSILON/2.0));
        times_i.insert(times_i.end(), temptimes.begin(), temptimes.end() );
        temptimes = roots(f[X]+3*(width?width:EPSILON/2.0));
        times_i.insert(times_i.end(), temptimes.begin(), temptimes.end() );
        for (double & k : times_i){
            k+=i;
        }
        times.insert(times.end(), times_i.begin(), times_i.end() );
    }
    std::sort( times.begin(),  times.end() );
    std::vector<double>::iterator new_end = std::unique( times.begin(),  times.end() );
    times.resize( new_end - times.begin() );

    double tmin = 0, tmax = size_nondegenerate(patha);
    double period = size_nondegenerate(patha);
    if (!times.empty()){
        unsigned rk = upper_bound( times.begin(),  times.end(), ta ) - times.begin();
        if ( rk < times.size() )
            tmax = times[rk];
        else if ( patha.closed() )
            tmax = times[0]+period;

        if ( rk > 0 )
            tmin = times[rk-1];
        else if ( patha.closed() )
            tmin = times.back()-period;
    }
    return Interval(tmin,tmax);
}

struct CrossingPoint {
    Geom::Point pt;
    int sign = 1; // +/-1 = positive or neg crossing, 0 = flat.
    unsigned i = 0, j = 0;  // paths components meeting in this point.
    unsigned ni = 0, nj = 0;  // this crossing is the ni-th along i, nj-th along j.
    double ti = 0, tj = 0;  // time along paths.
};

std::vector<CrossingPoint> crossings_from_paths(Geom::PathVector const &paths)
{
    std::vector<CrossingPoint> result;
    for( unsigned i=0; i<paths.size(); i++){
        for( unsigned ii=0; ii < size_nondegenerate(paths[i]); ii++){
            for( unsigned j=i; j<paths.size(); j++){
                for( unsigned jj=(i==j?ii:0); jj < size_nondegenerate(paths[j]); jj++){
                    std::vector<std::pair<double,double> > times;
                    if ( (i==j) && (ii==jj) ) {
                        find_self_intersections( times, paths[i][ii].toSBasis() );
                    } else {
                        find_intersections( times, paths[i][ii].toSBasis(), paths[j][jj].toSBasis() );
                    }
                    for (auto & time : times){
                        if ( !std::isnan(time.first) && !std::isnan(time.second) ){
                            double zero = 1e-4;
                            if ( (i==j) && (fabs(time.first+ii - time.second-jj) <= zero) )
                            { //this is just end=start of successive curves in a path.
                                continue;
                            }
                            if ( (i==j) && (ii == 0) && (jj == size_nondegenerate(paths[i])-1)
                                 && paths[i].closed()
                                 && (fabs(time.first) <= zero)
                                 && (fabs(time.second - 1) <= zero) )
                            {//this is just end=start of a closed path.
                                continue;
                            }
                            CrossingPoint cp;
                            cp.pt = paths[i][ii].pointAt(time.first);
                            cp.sign = 1;
                            cp.i = i;
                            cp.j = j;
                            cp.ni = 0; cp.nj=0;//not set yet
                            cp.ti = time.first + ii;
                            cp.tj = time.second + jj;
                            result.push_back(cp);
                        }
                    }
                }
            }
        }
    }
    for( unsigned i=0; i<paths.size(); i++){
        std::map < double, unsigned > cuts;
        for( unsigned k=0; k<result.size(); k++){
            CrossingPoint cp = result[k];
            if (cp.i == i) cuts[cp.ti] = k;
            if (cp.j == i) cuts[cp.tj] = k;
        }
        unsigned count = 0;
        for (auto & cut : cuts){
            if ( (result[cut.second].i == i) && (result[cut.second].ti == cut.first) ){
                result[cut.second].ni = count;
            }else{
                result[cut.second].nj = count;
            }
            count++;
        }
    }
    return result;
}

std::vector<double> to_vector(std::vector<CrossingPoint> const &cps)
{
    std::vector<double> result;
    for (auto const &cp : cps) {
        result.push_back(cp.pt[X]);
        result.push_back(cp.pt[Y]);
        result.push_back(double(cp.i));
        result.push_back(double(cp.j));
        result.push_back(double(cp.ni));
        result.push_back(double(cp.nj));
        result.push_back(double(cp.ti));
        result.push_back(double(cp.tj));
        result.push_back(double(cp.sign));
    }
    return result;
}

std::vector<CrossingPoint> from_vector(std::vector<double> const &input)
{
    std::vector<CrossingPoint> result;
    if ( (input.size() > 0) && (input.size()%9 == 0) ){
        for( unsigned n=0; n<input.size();  ){
            CrossingPoint cp;
            cp.pt[X] = input[n++];
            cp.pt[Y] = input[n++];
            cp.i = input[n++];
            cp.j = input[n++];
            cp.ni = input[n++];
            cp.nj = input[n++];
            cp.ti = input[n++];
            cp.tj = input[n++];
            cp.sign = input[n++];
            result.push_back(cp);
        }
    }
    return result;
}

/** LPEKnotNS::CrossingPoints(paths).to_vector() of the paths (lines and cubic Beziers). */
emscripten::val knot_crossings(std::string const &gpaths_d)
{
    PathVector const gpaths = parse_svg_path(gpaths_d.c_str());
    return emscripten::val::array(to_vector(crossings_from_paths(gpaths)));
}

/**
 * The visible pieces of component i0 of gpaths (the loop body of LPEKnot::doEffect_path).
 * p: interruption_width, prop_to_stroke_width, both, inverse_width, add_stroke_width,
 * add_other_stroke_width.
 */
std::string knot_component(std::string const &gpaths_d, unsigned i0, emscripten::val crossings_js,
                           emscripten::val widths_js, emscripten::val p)
{
    PathVector const gpaths = parse_svg_path(gpaths_d.c_str());
    std::vector<CrossingPoint> const crossing_points = from_vector(emscripten::vecFromJSArray<double>(crossings_js));
    std::vector<double> const gstroke_widths = emscripten::vecFromJSArray<double>(widths_js);
    double const interruption_width = p["interruption_width"].as<double>();
    bool const prop_to_stroke_width = p["prop_to_stroke_width"].as<bool>();
    bool const both = p["both"].as<bool>();
    bool const inverse_width = p["inverse_width"].as<bool>();
    bool const add_stroke_width = p["add_stroke_width"].as<bool>();
    bool const add_other_stroke_width = p["add_other_stroke_width"].as<bool>();
    Geom::PathVector path_out;
    if (i0 >= gpaths.size()) {
        return "";
    }

    std::vector<Interval> dom;
    dom.emplace_back(0., size_nondegenerate(gpaths[i0]));
    for (auto const &crossing_point : crossing_points) {
        if ((crossing_point.i == i0) || (crossing_point.j == i0)) {
            unsigned i = crossing_point.i;
            unsigned j = crossing_point.j;
            double ti = crossing_point.ti;
            double tj = crossing_point.tj;

            double curveidx, t;

            t = modf(ti, &curveidx);
            if(curveidx == size_nondegenerate(gpaths[i]) ) { curveidx--; t = 1.;}
            std::vector<Point> flag_i = gpaths[i][curveidx].pointAndDerivatives(t,1);

            t = modf(tj, &curveidx);
            if(curveidx == size_nondegenerate(gpaths[j]) ) { curveidx--; t = 1.;}
            std::vector<Point> flag_j = gpaths[j][curveidx].pointAndDerivatives(t,1);

            int geom_sign = ( cross(flag_i[1], flag_j[1]) < 0 ? 1 : -1);
            bool i0_is_under = false;
            double width = interruption_width;
            if ( crossing_point.sign * geom_sign > 0 ){
                i0_is_under = ( i == i0 );
            }
            else if (crossing_point.sign * geom_sign < 0) {
                if (j == i0){
                    i0_is_under = true;
                }
            }
            i0_is_under = crossing_point.sign != 0 && both ? true : i0_is_under;
            if (i0_is_under && j == i0) {
                // last check of sign makes sure we get different outputs when
                // path components are part of the same subpath (i == j)
                if (!(i == j && !both && crossing_point.sign * geom_sign > 0)) {
                    std::swap(i, j);
                    std::swap(ti, tj);
                    std::swap(flag_i, flag_j);
                }
            }
            if (i0_is_under){
                if ( prop_to_stroke_width ) {
                    if (inverse_width) {
                        width *= gstroke_widths[j];
                    }
                    else {
                        width *= gstroke_widths[i];
                    }
                }
                if (add_stroke_width) {
                    width += gstroke_widths[i];
                }
                if (add_other_stroke_width) {
                    width += gstroke_widths[j];
                }
                Interval hidden = findShadowedTime(gpaths[i0], flag_j, ti, width/2);
                double period  = size_nondegenerate(gpaths[i0]);
                if (hidden.max() > period ) hidden -= period;
                if (hidden.min()<0){
                    dom = complementOf( Interval(0,hidden.max()) ,dom);
                    dom = complementOf( Interval(hidden.min()+period, period) ,dom);
                }else{
                    dom = complementOf(hidden,dom);
                }
                if (crossing_point.i == i0 && crossing_point.j == i0 && crossing_point.sign != 0 &&
                    both) {
                    hidden = findShadowedTime(gpaths[i0], flag_i, tj, width / 2);
                    period = size_nondegenerate(gpaths[i0]);
                    if (hidden.max() > period)
                        hidden -= period;
                    if (hidden.min() < 0) {
                        dom = complementOf(Interval(0, hidden.max()), dom);
                        dom = complementOf(Interval(hidden.min() + period, period), dom);
                    }
                    else {
                        dom = complementOf(hidden, dom);
                    }
                }
            }
        }
    }

    //If the all component is hidden, continue.
    if (dom.empty()){
        return "";
    }

    //If the current path is closed and the last/first point is still there, glue first and last piece.
    unsigned beg_comp = 0, end_comp = dom.size();
    if ( gpaths[i0].closed() && (dom.front().min() == 0) && (dom.back().max() == size_nondegenerate(gpaths[i0])) ) {
        if ( dom.size() == 1){
            path_out.push_back(gpaths[i0]);
            return write_svg_path(path_out);
        }else{
            ++beg_comp;
            --end_comp;
            Geom::Path first = gpaths[i0].portion(dom.back());
            //FIXME: stitching should not be necessary (?!?)
            first.setStitching(true);
            first.append(gpaths[i0].portion(dom.front()));
            path_out.push_back(first);
        }
    }
    for (unsigned comp = beg_comp; comp < end_comp; comp++){
        path_out.push_back(gpaths[i0].portion(dom.at(comp)));
    }
    return write_svg_path(path_out);
}

// ---------------------------------------------------------------------------------------------
// lpe-embrodery-stitch.cpp: LPEEmbroderyStitch::doEffect_path. The sub-path ordering
// (lpe-embrodery-stitch-ordering.cpp) is compiled unchanged.

using namespace Inkscape::LivePathEffect::LPEEmbroderyStitchOrdering;

enum order_method {
    order_method_no_reorder,
    order_method_zigzag,
    order_method_zigzag_rev_first,
    order_method_closest,
    order_method_closest_rev_first,
    order_method_tsp_kopt_2,
    order_method_tsp_kopt_3,
    order_method_tsp_kopt_4,
    order_method_tsp_kopt_5,
    order_method_count
};
enum connect_method {
    connect_method_line,
    connect_method_move_point_from,
    connect_method_move_point_mid,
    connect_method_move_point_to,
    connect_method_count
};

struct EmbroderyStitch
{
    int ordering;
    int connection;
    double stitch_length;
    double stitch_min_length;
    int stitch_pattern;
    bool show_stitches;
    double show_stitch_gap;
    double jump_if_longer;

    double GetPatternInitialStep(int pattern, int line)
    {
        switch (pattern) {
        case 0:
            return 0.0;

        case 1:
            switch (line % 4) {
            case 0:
                return 0.0;
            case 1:
                return 0.25;
            case 2:
                return 0.50;
            case 3:
                return 0.75;
            }
            return 0.0;

        case 2:
            switch (line % 4) {
            case 0:
                return 0.0;
            case 1:
                return 0.5;
            case 2:
                return 0.75;
            case 3:
                return 0.25;
            }
            return 0.0;

        default:
            return 0.0;
        }

    }

    Point GetStartPointInterpolAfterRev(std::vector<OrderingInfo> const &info, unsigned i)
    {
        Point start_this = info[i].GetBegRev();

        if (i == 0) {
            return start_this;
        }

        if (!info[i - 1].connect) {
            return start_this;
        }

        Point end_prev = info[i - 1].GetEndRev();

        switch (connection) {
        case connect_method_line:
            return start_this;
        case connect_method_move_point_from:
            return end_prev;
        case connect_method_move_point_mid:
            return 0.5 * start_this + 0.5 * end_prev;
        case connect_method_move_point_to:
            return start_this;
        default:
            return start_this;
        }
    }
    Point GetEndPointInterpolAfterRev(std::vector<OrderingInfo> const &info, unsigned i)
    {
        Point end_this = info[i].GetEndRev();

        if (i + 1 == info.size()) {
            return end_this;
        }

        if (!info[i].connect) {
            return end_this;
        }

        Point start_next = info[i + 1].GetBegRev();

        switch (connection) {
        case connect_method_line:
            return end_this;
        case connect_method_move_point_from:
            return end_this;
        case connect_method_move_point_mid:
            return 0.5 * start_next + 0.5 * end_this;
        case connect_method_move_point_to:
            return start_next;
        default:
            return end_this;
        }
    }

    Point GetStartPointInterpolBeforeRev(std::vector<OrderingInfo> const &info, unsigned i)
    {
        if (info[i].reverse) {
            return GetEndPointInterpolAfterRev(info, i);
        } else {
            return GetStartPointInterpolAfterRev(info, i);
        }
    }

    Point GetEndPointInterpolBeforeRev(std::vector<OrderingInfo> const &info, unsigned i)
    {
        if (info[i].reverse) {
            return GetStartPointInterpolAfterRev(info, i);
        } else {
            return GetEndPointInterpolAfterRev(info, i);
        }
    }

    PathVector doEffect_path(PathVector const &path_in)
    {
        if (path_in.size() >= 2) {
            PathVector path_out;

            // Create vectors with start and end points
            std::vector<OrderingInfo> orderinginfos(path_in.size());
            // connect next path to this one
            bool connect_with_previous = false;

            for (PathVector::const_iterator it = path_in.begin(); it != path_in.end(); ++it) {
                OrderingInfo &info = orderinginfos[ it - path_in.begin() ];
                info.index = it - path_in.begin();
                info.reverse = false;
                info.used = false;
                info.connect = true;
                info.begOrig = it->initialPoint();
                info.endOrig = it->back().finalPoint();
            }

            // Compute sub-path ordering
            switch (ordering) {
            case order_method_no_reorder:
                OrderingOriginal(orderinginfos);
                break;

            case order_method_zigzag:
                OrderingZigZag(orderinginfos, false);
                break;

            case order_method_zigzag_rev_first:
                OrderingZigZag(orderinginfos, true);
                break;

            case order_method_closest:
                OrderingClosest(orderinginfos, false);
                break;

            case order_method_closest_rev_first:
                OrderingClosest(orderinginfos, true);
                break;

            case order_method_tsp_kopt_2:
                OrderingAdvanced(orderinginfos, 2);
                break;

            case order_method_tsp_kopt_3:
                OrderingAdvanced(orderinginfos, 3);
                break;

            case order_method_tsp_kopt_4:
                OrderingAdvanced(orderinginfos, 4);
                break;

            case order_method_tsp_kopt_5:
                OrderingAdvanced(orderinginfos, 5);
                break;

            }

            // Iterate over sub-paths in order found above
            // Divide paths into stitches (currently always equidistant)
            // Interpolate between neighboring paths, so that their ends coincide
            for (std::vector<OrderingInfo>::const_iterator it = orderinginfos.begin(); it != orderinginfos.end(); ++it) {
                // info index
                unsigned iInfo = it - orderinginfos.begin();
                // subpath index
                unsigned iPath = it->index;
                // decide of path shall be reversed
                bool reverse = it->reverse;
                // minimum stitch length in absolute measure
                double stitch_min_length_abs = stitch_min_length * 0.01 * stitch_length;

                // convert path to piecewise
                Piecewise<D2<SBasis> > pwOrig = path_in[iPath].toPwSb();
                // make piecewise equidistant in time
                Piecewise<D2<SBasis> > pwEqdist = arc_length_parametrization(pwOrig);
                Piecewise<D2<SBasis> > pwStitch;

                // cut into stitches
                double cutpos = 0.0;
                Interval pwdomain = pwEqdist.domain();

                // step length of first stitch
                double step = GetPatternInitialStep(stitch_pattern, iInfo) * stitch_length;
                if (step < stitch_min_length_abs) {
                    step += stitch_length;
                }

                bool last = false;
                bool first = true;
                double posnext;
                for (double pos = pwdomain.min(); !last; pos = posnext, cutpos += 1.0) {
                    // start point
                    Point p1;
                    if (first) {
                        p1 = GetStartPointInterpolBeforeRev(orderinginfos, iInfo);
                        first = false;
                    } else {
                        p1 =  pwEqdist.valueAt(pos);
                    }

                    // end point of this stitch
                    Point p2;
                    posnext = pos + step;
                    // last stitch is to end
                    if (posnext >= pwdomain.max() - stitch_min_length_abs) {
                        p2 = GetEndPointInterpolBeforeRev(orderinginfos, iInfo);
                        last = true;
                    } else {
                        p2 = pwEqdist.valueAt(posnext);
                    }

                    pwStitch.push_cut(cutpos);
                    pwStitch.push_seg(D2<SBasis>(SBasis(Linear(p1[X], p2[X])), SBasis(Linear(p1[Y], p2[Y]))));

                    // stitch length for all except first step
                    step = stitch_length;
                }
                pwStitch.push_cut(cutpos);

                if (reverse) {
                    pwStitch = Geom::reverse(pwStitch);
                }

                if (it->connect && iInfo != orderinginfos.size() - 1) {
                    // Connect this segment with the previous segment by a straight line
                    Point end = pwStitch.lastValue();
                    Point start_next = GetStartPointInterpolAfterRev(orderinginfos, iInfo + 1);
                    // connect end and start point
                    if (end != start_next && distance(end, start_next) <= jump_if_longer) {
                        cutpos += 1.0;
                        pwStitch.push_seg(D2<SBasis>(SBasis(Linear(end[X], start_next[X])), SBasis(Linear(end[Y], start_next[Y]))));
                        pwStitch.push_cut(cutpos);
                    }
                }

                if (show_stitches) {
                    for (auto & seg : pwStitch.segs) {
                        // Create  anew piecewise with just one segment
                        Piecewise<D2<SBasis> > pwOne;
                        pwOne.push_cut(0);
                        pwOne.push_seg(seg);
                        pwOne.push_cut(1);

                        // make piecewise equidistant in time
                        Piecewise<D2<SBasis> > pwOneEqdist = arc_length_parametrization(pwOne);
                        Interval pwdomain = pwOneEqdist.domain();

                        // Compute the points of the shortened piece
                        Coord len = pwdomain.max() - pwdomain.min();
                        Coord offs = 0.5 * (show_stitch_gap < 0.5 * len ? show_stitch_gap : 0.5 * len);
                        Point p1 = pwOneEqdist.valueAt(pwdomain.min() + offs);
                        Point p2 = pwOneEqdist.valueAt(pwdomain.max() - offs);

                        // Create Linear SBasis
                        D2<SBasis> sbasis = D2<SBasis>(SBasis(Linear(p1[X], p2[X])), SBasis(Linear(p1[Y], p2[Y])));

                        // Convert to path and add to path list
                        Geom::Path path = path_from_sbasis(sbasis , LPE_CONVERSION_TOLERANCE, false);
                        path_out.push_back(path);
                    }
                } else {
                    PathVector pathv = path_from_piecewise(pwStitch, LPE_CONVERSION_TOLERANCE);
                    for (const auto & ipv : pathv) {
                        if (connect_with_previous) {
                            path_out.back().append(ipv);
                        } else {
                            path_out.push_back(ipv);
                        }
                    }
                }

                connect_with_previous = it->connect;
            }

            return path_out;
        } else {
            return path_in;
        }
    }
};

/**
 * LPEEmbroderyStitch::doEffect_path. p: ordering, connection, stitch_length, stitch_min_length,
 * stitch_pattern, show_stitches, show_stitch_gap, jump_if_longer.
 */
std::string embrodery_stitch_path(std::string const &d, emscripten::val p)
{
    EmbroderyStitch es{p["ordering"].as<int>(),
                       p["connection"].as<int>(),
                       p["stitch_length"].as<double>(),
                       p["stitch_min_length"].as<double>(),
                       p["stitch_pattern"].as<int>(),
                       p["show_stitches"].as<bool>(),
                       p["show_stitch_gap"].as<double>(),
                       p["jump_if_longer"].as<double>()};
    return write_svg_path(es.doEffect_path(parse_svg_path(d.c_str())));
}

// ---------------------------------------------------------------------------------------------
// lpe-attach-path.cpp: Geom::Curve::pointAndDerivatives() of the first curve of d (lpe-attach-path.cpp): [x, y, dx, dy, ...].

emscripten::val curve_point_and_derivatives(std::string const &d, double t, unsigned n)
{
    PathVector const pv = parse_svg_path(d.c_str());
    std::vector<double> result;
    if (!pv.empty() && !pv[0].empty()) {
        for (auto const &p : pv[0].front().pointAndDerivatives(t, n)) {
            result.push_back(p[X]);
            result.push_back(p[Y]);
        }
    }
    return emscripten::val::array(result);
}

// Geom::Path::nearestTime(p).asFlatTime() of the first path of d (lpe-attach-path.cpp).
double path_nearest_flat_time(std::string const &d, double x, double y)
{
    PathVector const pv = parse_svg_path(d.c_str());
    if (pv.empty()) {
        return 0;
    }
    return pv[0].nearestTime(Point(x, y)).asFlatTime();
}

} // namespace

EMSCRIPTEN_BINDINGS(lpe_pwd2)
{
    emscripten::function("identityPwd2Path", &identity_pwd2_path);
    emscripten::function("recursiveSkeletonPath", &recursive_skeleton_path);
    emscripten::function("extrudePath", &extrude_path);
    emscripten::function("gearsPath", &gears_path);
    emscripten::function("latticePath", &lattice_path);
    emscripten::function("lattice2Path", &lattice2_path);
    emscripten::function("roughHatchesPath", &rough_hatches_path);
    emscripten::function("dynastrokePath", &dynastroke_path);
    emscripten::function("knotCrossings", &knot_crossings);
    emscripten::function("knotComponent", &knot_component);
    emscripten::function("embroderyStitchPath", &embrodery_stitch_path);
    emscripten::function("curvePointAndDerivatives", &curve_point_and_derivatives);
    emscripten::function("pathNearestFlatTime", &path_nearest_flat_time);
}
