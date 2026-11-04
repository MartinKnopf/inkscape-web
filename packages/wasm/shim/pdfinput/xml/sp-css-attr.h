// SPDX-License-Identifier: GPL-2.0-or-later
// SPCSSAttr of the PDF import shim: a node whose attributes are CSS properties.
#pragma once
#include "xml/node.h"

class SPCSSAttr : public Inkscape::XML::Node
{
public:
    SPCSSAttr()
        : Node(Inkscape::XML::NodeType::ELEMENT_NODE, "css", nullptr)
    {}
};
