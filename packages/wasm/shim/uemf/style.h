// SPDX-License-Identifier: GPL-2.0-or-later
// SPStyle of the EMF and WMF import: only the properties that the device context of
// emf-inout.cpp and wmf-inout.cpp keeps (style.h, style-internal.h). The import writes
// the style as SVG text; the TypeScript document model reads it.
#pragma once
#include <optional>
#include <vector>
#include "colors/color.h"
#include "style-enums.h"
#include "svg/stringstream.h" // upstream style.h brings it in through style-internal.h

class SPILength
{
public:
    SPILength(float v = 0.f)
        : value(v)
        , computed(v)
    {}
    void setDouble(double v) { value = computed = v; }
    bool operator==(SPILength const &o) const { return value == o.value; }
    float value;
    float computed;
};

class SPIFloat
{
public:
    float value = 0.f;
    float computed = 0.f;
};

template <typename T>
class SPIEnum
{
public:
    T value{};
    T computed{};
};

class SPIPaint
{
public:
    bool set = false;
    Inkscape::Colors::Color getColor() const { return _color; }
    void setColor(Inkscape::Colors::Color const &color)
    {
        _color = color;
        set = true;
    }

private:
    Inkscape::Colors::Color _color{0x000000ff};
};

class SPIDashArray
{
public:
    bool set = false;
    std::vector<SPILength> values;
    bool operator==(SPIDashArray const &o) const { return values == o.values; }
    bool operator!=(SPIDashArray const &o) const { return !(*this == o); }
};

class SPITextDecorationLine
{
public:
    bool set = false;
    bool inherit = false;
    bool underline = false;
    bool overline = false;
    bool line_through = false;
    bool blink = false;
};

class SPStyle
{
public:
    SPIPaint fill;
    SPIPaint stroke;
    SPIEnum<SPWindRule> fill_rule;
    SPILength stroke_width{1.f};
    SPIEnum<SPStrokeCapType> stroke_linecap;
    SPIEnum<SPStrokeJoinType> stroke_linejoin;
    SPIFloat stroke_miterlimit{4.f, 4.f};
    SPIDashArray stroke_dasharray;
    SPIEnum<SPCSSFontWeight> font_weight{SP_CSS_FONT_WEIGHT_NORMAL, SP_CSS_FONT_WEIGHT_400};
    SPIEnum<SPCSSFontStyle> font_style;
    SPILength font_size{12.f};
    SPILength baseline_shift;
    SPITextDecorationLine text_decoration_line;
};
