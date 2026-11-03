// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API for the 2geom parts of the Interpolate Sub-Paths and Sketch path effects
// (their doEffect_path / doEffect_pwd2 copied from upstream, with the parameters passed in).
// The effects are ported to TypeScript (packages/core/src/live_effects). Geometry is SVG path data.
//
// Upstream: src/live_effects/lpe-interpolate.cpp, src/live_effects/lpe-sketch.cpp
/*
 * Authors:
 *   Johan Engelen
 *   Jean-Francois Barraud
 *
 * Copyright (C) Johan Engelen 2007-2008
 */
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/bezier-to-sbasis.h>
#include <2geom/path.h>
#include <2geom/pathvector.h>
#include <2geom/piecewise.h>
#include <2geom/ray.h>
#include <2geom/sbasis-geometric.h>
#include <2geom/sbasis-math.h>
#include <2geom/sbasis-to-bezier.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>

namespace {

using namespace Geom;
using Pwd2 = Piecewise<D2<SBasis>>;

constexpr double LPE_CONVERSION_TOLERANCE = 0.01; // effect.h

/**
 * LPEInterpolate::doEffect_path: interpolate path_in[0] to path_in[1]. trajectory_d is the
 * trajectory path, already in the item's coordinates.
 */
std::string interpolate_path(std::string const &d, std::string const &trajectory_d, double number_of_steps,
                             bool equidistant_spacing)
{
    PathVector const path_in = parse_svg_path(d.c_str());
    PathVector const trajectory_pv = parse_svg_path(trajectory_d.c_str());
    if ((path_in.size() < 2) || (number_of_steps < 2)) {
        return d;
    }
    // Don't allow empty path parameter:
    if (trajectory_pv.empty()) {
        return d;
    }
    Geom::PathVector path_out;

    Geom::Piecewise<Geom::D2<Geom::SBasis> > pwd2_A = path_in[0].toPwSb();
    Geom::Piecewise<Geom::D2<Geom::SBasis> > pwd2_B = path_in[1].toPwSb();

    // Transform both paths to (0,0) midpoint, so they can easily be positioned along interpolate_path
    Geom::OptRect bounds_A = Geom::bounds_exact(pwd2_A);
    if (bounds_A) {
        pwd2_A -= bounds_A->midpoint();
    }
    Geom::OptRect bounds_B = Geom::bounds_exact(pwd2_B);
    if (bounds_B) {
        pwd2_B -= bounds_B->midpoint();
    }

    // Make sure both paths have the same number of segments and cuts at the same locations
    pwd2_B.setDomain(pwd2_A.domain());
    Geom::Piecewise<Geom::D2<Geom::SBasis> > pA = Geom::partition(pwd2_A, pwd2_B.cuts);
    Geom::Piecewise<Geom::D2<Geom::SBasis> > pB = Geom::partition(pwd2_B, pwd2_A.cuts);

    // calculate_trajectory(): the trajectory, transformed so that it starts at the bounding box
    // center of the first path and ends at the bounding box center of the second path
    Geom::Piecewise<Geom::D2<Geom::SBasis> > trajectory = trajectory_pv[0].toPwSb();
    if (equidistant_spacing) {
        trajectory = Geom::arc_length_parametrization(trajectory);
    }
    if (bounds_A && bounds_B) {
        auto trajectory_start = trajectory.firstValue();
        auto trajectory_end = trajectory.lastValue();
        auto midpoint_A = bounds_A->midpoint();
        auto midpoint_B = bounds_B->midpoint();
        Geom::Ray original(trajectory_start, trajectory_end);
        Geom::Ray transformed(midpoint_A, midpoint_B);
        double rotation = transformed.angle() - original.angle();
        double scale = Geom::distance(midpoint_A, midpoint_B) / Geom::distance(trajectory_start, trajectory_end);
        Geom::Affine transformation;
        transformation *= Geom::Translate(-trajectory_start);
        transformation *= Geom::Scale(scale, scale);
        transformation *= Geom::Rotate(rotation);
        transformation *= Geom::Translate(midpoint_A);
        trajectory = trajectory * transformation;
    }

    Geom::Interval trajectory_domain = trajectory.domain();

    for (int i = 0; i < number_of_steps; ++i) {
        double fraction = i / (number_of_steps - 1);

        Geom::Piecewise<Geom::D2<Geom::SBasis> > pResult = pA * (1 - fraction) + pB * fraction;
        pResult += trajectory.valueAt(trajectory_domain.min() + fraction * trajectory_domain.extent());

        Geom::PathVector pathv = Geom::path_from_piecewise(pResult, LPE_CONVERSION_TOLERANCE);
        path_out.push_back(pathv[0]);
    }

    return write_svg_path(path_out);
}

/**
 * The parameters of LPESketch. A RandomParam gives a new random number each time the upstream
 * code reads it as a double (R); get_value() is V. The random numbers come from the TypeScript
 * parameters, so the sequence is the same as upstream.
 */
struct Sketch
{
    enum Rnd { STROKELENGTH_RDM, STROKEOVERLAP_RDM, ENDS_TOLERANCE, PARALLEL_OFFSET, TREMBLE_SIZE, TGTLENGTH_RDM,
               TGT_PLACES_RDMNESS };
    emscripten::val rnd;    // rnd(k): the next random number of RandomParam k
    std::vector<double> v;  // v[k]: get_value() of RandomParam k
    double nbiter_approxstrokes;
    double strokelength;
    double strokeoverlap;
    double tremble_frequency;
    double nbtangents;
    double tgtscale;
    double tgtlength;

    double R(Rnd k) const { return rnd(static_cast<int>(k)).as<double>(); }
    double V(Rnd k) const { return v.at(k); }

    Geom::Piecewise<Geom::D2<Geom::SBasis> >
    computePerturbation (double s0, double s1){
        using namespace Geom;
        Piecewise<D2<SBasis> >res;

        //global offset for this stroke.
        double offsetX = 2*R(PARALLEL_OFFSET)-V(PARALLEL_OFFSET);
        double offsetY = 2*R(PARALLEL_OFFSET)-V(PARALLEL_OFFSET);
        Point A,dA,B,dB,offset = Point(offsetX,offsetY);
        //start point A
        for (unsigned dim=0; dim<2; dim++){
            A[dim]  = offset[dim] + 2*R(TREMBLE_SIZE)-V(TREMBLE_SIZE);
            dA[dim] = 2*R(TREMBLE_SIZE)-V(TREMBLE_SIZE);
        }
        //compute howmany deg 3 sbasis to concat according to frequency.

        unsigned count = unsigned((s1-s0)/strokelength*tremble_frequency)+1;
        //unsigned count = unsigned((s1-s0)/strokelength*tremble_frequency)+1;

        for (unsigned i=0; i<count; i++){
            D2<SBasis> perturb = D2<SBasis>(SBasis(2, Linear()), SBasis(2, Linear()));
            for (unsigned dim=0; dim<2; dim++){
                B[dim] = offset[dim] + 2*R(TREMBLE_SIZE)-V(TREMBLE_SIZE);
                perturb[dim][0] = Linear(A[dim],B[dim]);
                dA[dim] = dA[dim]-B[dim]+A[dim];
                //avoid dividing by 0. Very short strokes will have ends parallel to the curve...
                if ( s1-s0 > 1e-2)
                    dB[dim] = -(2*R(TREMBLE_SIZE)-V(TREMBLE_SIZE))/(s0-s1)-B[dim]+A[dim];
                else
                    dB[dim] = -(2*R(TREMBLE_SIZE)-V(TREMBLE_SIZE))-B[dim]+A[dim];
                perturb[dim][1] = Linear(dA[dim],dB[dim]);
            }
            dA = B-A-dB;
            A = B;
            //dA = B-A-dB;
            res.concat(Piecewise<D2<SBasis> >(perturb));
        }
        res.setDomain(Interval(s0,s0+count*strokelength/tremble_frequency));
        return res;
    }

    // Main effect body...
    Geom::Piecewise<Geom::D2<Geom::SBasis> >
    doEffect_pwd2 (Geom::Piecewise<Geom::D2<Geom::SBasis> > const & pwd2_in)
    {
        using namespace Geom;
        //If the input path is empty, do nothing.
        //Note: this happens when duplicating a 3d box... dunno why.
        if (pwd2_in.empty() || (pwd2_in.size() == 1 && pwd2_in[0].isConstant())) {
            return pwd2_in;
        }

        Piecewise<D2<SBasis> > output;

        // some variables for futur use (for construction lines; compute arclength only once...)
        // notations will be : t = path time, s = distance from start along the path.
        Piecewise<SBasis> pathlength;
        double total_length = 0;

        //TODO: split Construction Lines/Approximated Strokes into two separate effects?

        //----- Approximated Strokes.
        std::vector<Piecewise<D2<SBasis> > > pieces_in = split_at_discontinuities (pwd2_in);

        //work separately on each component.
        for (auto piece : pieces_in){

            Piecewise<SBasis> piecelength = arcLengthSb(piece,.1);
            double piece_total_length = piecelength.segs.back().at1()-piecelength.segs.front().at0();
            pathlength.concat(piecelength + total_length);
            total_length += piece_total_length;


            //TODO: better check this on the Geom::Path.
            bool closed = piece.segs.front().at0() == piece.segs.back().at1();
            if (closed){
                piece.concat(piece);
                piecelength.concat(piecelength+piece_total_length);
            }

            for (unsigned i = 0; i<nbiter_approxstrokes; i++){
                //Basic steps:
                //- Choose a rdm seg [s0,s1], find corresponding [t0,t1],
                //- Pick a rdm perturbation delta(s), collect 'piece(t)+delta(s(t))' over [t0,t1] into output.

                // pick a point where to start the stroke (s0 = dist from start).
                double s1=0.,s0 = R(ENDS_TOLERANCE)*strokelength+0.0001;//the root finder might miss 0.
                double t1, t0;
                double s0_initial = s0;
                bool done = false;// was the end of the component reached?

                while (!done){
                    // if the start point is already too far... do nothing. (this should not happen!)
                    if (!closed && s1>piece_total_length - V(ENDS_TOLERANCE)*strokelength) break;
                    if ( closed && s0>piece_total_length + s0_initial) break;

                    std::vector<double> times;

                    //pick a new end point (s1 = s0 + strokelength).
                    times = roots(piecelength-s0);
                    t0 = times.at(0);//there should be one and only one solution!!

                    s1 = s0 + strokelength*(1-R(STROKELENGTH_RDM));
                    // don't let it go beyond the end of the original path.
                    // TODO/FIXME: this might result in short strokes near the end...
                    if (!closed && s1>piece_total_length-V(ENDS_TOLERANCE)*strokelength){
                        done = true;
                        //!!the root solver might miss s1==piece_total_length...
                        if (s1>piece_total_length){s1 = piece_total_length - R(ENDS_TOLERANCE)*strokelength-0.0001;}
                    }
                    if (closed && s1>piece_total_length + s0_initial){
                        done = true;
                        if (closed && s1>2*piece_total_length){
                            s1 = 2*piece_total_length - strokeoverlap*(1-R(STROKEOVERLAP_RDM))*strokelength-0.0001;
                        }
                    }
                    times = roots(piecelength-s1);
                    if (times.empty()) break;//we should not be there.
                    t1 = times[0];

                    //pick a rdm perturbation, and collect the perturbed piece into output.
                    Piecewise<D2<SBasis> > pwperturb = computePerturbation(s0-0.01,s1+0.01);
                    pwperturb = compose(pwperturb,portion(piecelength,t0,t1));

                    output.concat(portion(piece,t0,t1)+pwperturb);

                    //step points: s0 = s1 - overlap.
                    //TODO: make sure this has to end?
                    s0 = s1 - strokeoverlap*(1-R(STROKEOVERLAP_RDM))*(s1-s0);
                }
            }
        }

        //----- Construction lines.
        //TODO: choose places according to curvature?.

        //at this point we should have:
        //pathlength = arcLengthSb(pwd2_in,.1);
        //total_length = pathlength.segs.back().at1()-pathlength.segs.front().at0();
        Piecewise<D2<SBasis> > m = pwd2_in;
        Piecewise<D2<SBasis> > v = derivative(pwd2_in);
        Piecewise<D2<SBasis> > a = derivative(v);

        for (unsigned i=0; i<nbtangents; i++){

            // pick a point where to draw a tangent (s = dist from start along path).
            double reg_place = total_length * ( i + .5) / ( nbtangents );
            double rdm_place = total_length * R(TGT_PLACES_RDMNESS);
            double s = ( 1.- V(TGT_PLACES_RDMNESS) ) * reg_place  +  rdm_place ;
            std::vector<double> times;
            times = roots(pathlength-s);
            double t = times.at(0);//there should be one and only one solution!

            Point m_t = m(t), v_t = v(t), a_t = a(t);
            //Compute tgt length according to curvature (not exceeding tgtlength) so that
            //  dist to origninal curve ~ 4 * (parallel_offset+tremble_size).
            //TODO: put this 4 as a parameter in the UI...
            //TODO: what if with v=0?
            double l = tgtlength*(1-R(TGTLENGTH_RDM))/v_t.length();
            double r = std::pow(v_t.length(), 3) / cross(v_t, a_t);
            r = sqrt((2*fabs(r)-tgtscale)*tgtscale)/v_t.length();
            l=(r<l)?r:l;
            //collect the tgt segment into output.
            D2<SBasis> tgt = D2<SBasis>();
            for (unsigned dim=0; dim<2; dim++){
                tgt[dim] = SBasis(Linear(m_t[dim]-v_t[dim]*l, m_t[dim]+v_t[dim]*l));
            }
            output.concat(Piecewise<D2<SBasis> >(tgt));
        }

        return output;
    }
};

/**
 * LPESketch with Effect::doEffect_path (concatenate_before_pwd2). Returns "!" when the upstream
 * code throws (upstream: the effect is not applied).
 */
std::string sketch_path(std::string const &d, emscripten::val rnd, emscripten::val values, double nbiter_approxstrokes,
                        double strokelength, double strokeoverlap, double tremble_frequency, double nbtangents,
                        double tgtscale, double tgtlength)
{
    Sketch sketch{rnd,
                  emscripten::vecFromJSArray<double>(values),
                  nbiter_approxstrokes,
                  strokelength,
                  strokeoverlap,
                  tremble_frequency,
                  nbtangents,
                  tgtscale,
                  tgtlength};
    try {
        PathVector const path_in = parse_svg_path(d.c_str());
        Pwd2 pwd2_in;
        for (auto const &i : path_in) {
            pwd2_in.concat(i.toPwSb());
        }
        return write_svg_path(path_from_piecewise(sketch.doEffect_pwd2(pwd2_in), LPE_CONVERSION_TOLERANCE));
    } catch (std::exception const &) {
        return "!";
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(lpe_generate)
{
    emscripten::function("interpolatePath", &interpolate_path);
    emscripten::function("sketchPath", &sketch_path);
}
