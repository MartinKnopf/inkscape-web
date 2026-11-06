/* SPDX-License-Identifier: GPL-2.0-or-later */
/* iconv of the EMF and WMF sources (libuemf, text_reassemble.c). The musl iconv of Emscripten
 * has no //TRANSLIT: libuemf opens "LATIN1//TRANSLIT" for the WMF text, which then fails.
 * These wrappers handle that target (shim/uemf/iconv.c) and pass everything else to musl.
 */
#ifndef SHIM_UEMF_ICONV_H
#define SHIM_UEMF_ICONV_H

#include_next <iconv.h>

#ifdef __cplusplus
extern "C" {
#endif

iconv_t shim_iconv_open(const char *tocode, const char *fromcode);
size_t shim_iconv(iconv_t cd, char **inbuf, size_t *inbytesleft, char **outbuf, size_t *outbytesleft);
int shim_iconv_close(iconv_t cd);
/** The Latin1 transliteration of a code point: "" if there is none (then iconv writes '?'). */
const char *shim_latin1_translit(unsigned int cp);

#ifdef __cplusplus
}
#endif

#define iconv_open(to, from) shim_iconv_open(to, from)
#define iconv(cd, in, inleft, out, outleft) shim_iconv(cd, in, inleft, out, outleft)
#define iconv_close(cd) shim_iconv_close(cd)

#endif
