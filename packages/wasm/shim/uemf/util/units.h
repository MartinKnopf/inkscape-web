// SPDX-License-Identifier: GPL-2.0-or-later
// Inkscape::Util::Unit and Quantity::convert for the absolute units of share/ui/units.xml.
#pragma once
#include <string>

namespace Inkscape::Util {
struct Unit
{
    std::string abbr = "px";
};

class Quantity
{
public:
    static double convert(double from_dist, std::string const &from, std::string const &to)
    {
        return from_dist * factor(from) / factor(to);
    }
    static double convert(double from_dist, std::string const &from, Unit const *to)
    {
        return convert(from_dist, from, to->abbr);
    }

private:
    /** Size of the unit in px. */
    static double factor(std::string const &unit)
    {
        if (unit == "pt")
            return 96.0 / 72.0;
        if (unit == "pc")
            return 16.0;
        if (unit == "mm")
            return 96.0 / 25.4;
        if (unit == "cm")
            return 96.0 / 2.54;
        if (unit == "in")
            return 96.0;
        return 1.0; // px
    }
};
} // namespace Inkscape::Util
