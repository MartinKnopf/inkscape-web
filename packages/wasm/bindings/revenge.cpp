// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/rvng-import-dialog.cpp, src/extension/internal/cdr-input.cpp, src/extension/internal/vsd-input.cpp, src/extension/internal/wpg-input.cpp
// Embind API of the CorelDRAW, Visio and WordPerfect Graphics import: the librevenge part of
// rvng_open() and WpgInput::open(). The file data comes from JavaScript in place of an
// RVNGFileStream; each page goes back as the SVG text of RVNGSVGDrawingGenerator. The page
// selection and the SVG import are in TypeScript (packages/editor/src/extension/internal).
#include <memory>
#include <string>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <libcdr/libcdr.h>
#include <librevenge-stream/librevenge-stream.h>
#include <librevenge/librevenge.h>
#include <libvisio/libvisio.h>
#include <libwpg/libwpg.h>

using emscripten::val;
using librevenge::RVNGInputStream;
using librevenge::RVNGStringStream;
using librevenge::RVNGStringVector;

namespace {

/** The pages as an array of strings, or null when the parser fails or makes no page. */
val pages(RVNGStringVector const &output)
{
    if (output.empty()) {
        return val::null();
    }
    auto result = val::array();
    for (unsigned i = 0; i < output.size(); ++i) {
        result.call<void>("push", std::string(output[i].cstr(), output[i].size()));
    }
    return result;
}

/** rvng_open() without the dialog: null if the format is not supported or the parser fails. */
val rvng_parse(val const &bytes, bool (*is_supported)(RVNGInputStream *),
               bool (*parse)(RVNGInputStream *, librevenge::RVNGDrawingInterface *))
{
    auto data = emscripten::convertJSArrayToNumberVector<unsigned char>(bytes);
    RVNGStringStream input(data.data(), data.size());

    if (!is_supported(&input)) {
        return val::null();
    }

    RVNGStringVector output;
    librevenge::RVNGSVGDrawingGenerator generator(output, "svg");

    if (!parse(&input, &generator)) {
        return val::null();
    }
    return pages(output);
}

val cdr_parse(val const &bytes)
{
    return rvng_parse(bytes, libcdr::CDRDocument::isSupported, libcdr::CDRDocument::parse);
}

val vsd_parse(val const &bytes)
{
    return rvng_parse(bytes, libvisio::VisioDocument::isSupported, libvisio::VisioDocument::parse);
}

/** WpgInput::open() up to the SVG text of the first page: null if it is not supported. */
val wpg_parse(val const &bytes)
{
    auto data = emscripten::convertJSArrayToNumberVector<unsigned char>(bytes);
    std::unique_ptr<RVNGInputStream> input = std::make_unique<RVNGStringStream>(data.data(), data.size());

    if (input->isStructured()) {
        if (auto olestream = input->getSubStreamByName("PerfectOffice_MAIN")) {
            input.reset(olestream);
        }
    }

    if (!libwpg::WPGraphics::isSupported(input.get())) {
        return val::null();
    }

    RVNGStringVector vec;
    librevenge::RVNGSVGDrawingGenerator generator(vec, "");

    if (!libwpg::WPGraphics::parse(input.get(), &generator) || vec.empty() || vec[0].empty()) {
        return val::null();
    }
    return pages(vec);
}

} // namespace

EMSCRIPTEN_BINDINGS(revenge)
{
    emscripten::function("cdrParse", &cdr_parse);
    emscripten::function("vsdParse", &vsd_parse);
    emscripten::function("wpgParse", &wpg_parse);
}
