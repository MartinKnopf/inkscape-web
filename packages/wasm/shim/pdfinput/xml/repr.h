// SPDX-License-Identifier: GPL-2.0-or-later
// The style functions of xml/repr.h (upstream xml/repr-css.cpp) for the PDF import shim.
#pragma once
#include <string>
#include <glibmm/ustring.h>
#include "xml/document.h"
#include "xml/node.h"
#include "xml/sp-css-attr.h"

SPCSSAttr *sp_repr_css_attr_new();
void sp_repr_css_attr_unref(SPCSSAttr *css);
/** The CSS properties of the attribute attr (a style attribute) of repr. */
SPCSSAttr *sp_repr_css_attr(Inkscape::XML::Node const *repr, char const *attr);
char const *sp_repr_css_property(SPCSSAttr *css, char const *name, char const *defval);
void sp_repr_css_set_property(SPCSSAttr *css, char const *name, char const *value);
inline void sp_repr_css_set_property(SPCSSAttr *css, char const *name, std::string const &value)
{
    sp_repr_css_set_property(css, name, value.c_str());
}
void sp_repr_css_set_property_double(SPCSSAttr *css, char const *name, double value);
void sp_repr_css_write_string(SPCSSAttr *css, Glib::ustring &str);
void sp_repr_css_set(Inkscape::XML::Node *repr, SPCSSAttr *css, char const *key);
void sp_repr_css_merge(SPCSSAttr *dst, SPCSSAttr const *src);
void sp_repr_css_attr_add_from_string(SPCSSAttr *css, char const *data);
/** Merge css into the style attribute key of repr; properties without a value are removed. */
void sp_repr_css_change(Inkscape::XML::Node *repr, SPCSSAttr *css, char const *key);
