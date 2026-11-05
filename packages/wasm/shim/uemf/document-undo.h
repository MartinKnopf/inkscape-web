// SPDX-License-Identifier: GPL-2.0-or-later
// DocumentUndo::ScopedInsensitive of document-undo.h (Metafile::setViewBoxIfMissing, which
// the import does not call).
#pragma once
class SPDocument;
namespace Inkscape {
class DocumentUndo
{
public:
    class ScopedInsensitive
    {
    public:
        explicit ScopedInsensitive(SPDocument *) {}
    };
};
} // namespace Inkscape
