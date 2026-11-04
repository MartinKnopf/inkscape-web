// SPDX-License-Identifier: GPL-2.0-or-later
// The part of Inkscape::Colors that the PDF import uses: sRGB, gray and CMYK colors printed
// as Inkscape prints them (colors/spaces/rgb.cpp, gray.h, cmyk.cpp). There is no color
// management (see lcms2.h): ICC profiles are not available.
#pragma once
#include <memory>
#include <string>
#include <vector>
#include "lcms2.h"

namespace Inkscape {
namespace Colors {

enum class RenderingIntent
{
    UNKNOWN = 0,
    AUTO = 1,
    PERCEPTUAL = 2,
    RELATIVE_COLORIMETRIC = 3,
    SATURATION = 4,
    ABSOLUTE_COLORIMETRIC = 5,
    RELATIVE_COLORIMETRIC_NOBPC = 6,
};

namespace Space {
enum class Type { NONE, Alpha, Gray, RGB, CMYK };

class AnySpace
{
public:
    explicit AnySpace(Type type)
        : _type(type)
    {}
    Type getType() const { return _type; }
    std::string toString(std::vector<double> const &values) const;

private:
    Type _type;
};
} // namespace Space

class Color
{
public:
    Color(std::shared_ptr<Space::AnySpace> space, std::vector<double> values)
        : _space(std::move(space))
        , _values(std::move(values))
    {}
    std::string toString() const { return _space ? _space->toString(_values) : ""; }

private:
    std::shared_ptr<Space::AnySpace> _space;
    std::vector<double> _values;
};

class Manager
{
public:
    static Manager &get();
    std::shared_ptr<Space::AnySpace> find(Space::Type type);
};

namespace CMS {
class Profile
{
public:
    static std::shared_ptr<Profile> create(cmsHPROFILE) { return nullptr; }
    template <typename T>
    static std::shared_ptr<Profile> create_from_copy(T) { return nullptr; }
    cmsColorSpaceSignature getColorSpace() const { return cmsSigXYZData; }
};
} // namespace CMS

class DocumentCMS
{
public:
    template <typename S>
    std::string attachProfileToDoc(CMS::Profile const &, S, RenderingIntent) { return ""; }
    std::shared_ptr<Space::AnySpace> getSpace(std::string const &) { return nullptr; }
};

} // namespace Colors
} // namespace Inkscape

enum class ColorProfileStorage { HREF_DATA, HREF_FILE, LOCAL_ID };
