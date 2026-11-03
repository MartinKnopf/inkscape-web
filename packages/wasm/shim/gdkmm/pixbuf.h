// SPDX-License-Identifier: GPL-2.0-or-later
// Minimal gdkmm shim for src/trace/imagemap-gdk.h: it only declares functions that take a
// Glib::RefPtr<Gdk::Pixbuf>. The WASM module does not compile imagemap-gdk.cpp; the web
// code converts its pixel buffers itself.
#pragma once
#include <memory>

namespace Glib {
template <class T>
using RefPtr = std::shared_ptr<T>;
} // namespace Glib

namespace Gdk {
class Pixbuf;
} // namespace Gdk
