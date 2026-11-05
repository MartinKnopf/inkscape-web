// SPDX-License-Identifier: GPL-2.0-or-later
// ShapeEditor::blockSetItem of ui/shape-editor.h (Metafile::setViewBoxIfMissing, which the
// import does not call).
#pragma once
namespace Inkscape::UI {
class ShapeEditor
{
public:
    static void blockSetItem(bool) {}
};
} // namespace Inkscape::UI
