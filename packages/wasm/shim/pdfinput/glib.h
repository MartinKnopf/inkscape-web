// SPDX-License-Identifier: GPL-2.0-or-later
// The glib functions that the PDF import sources use (no glib in WASM).
#pragma once
#include <cassert>
#include <cctype>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <strings.h>

typedef char gchar;
typedef unsigned char guchar;
typedef int gint;
typedef unsigned int guint;
typedef int gboolean;
typedef void *gpointer;
typedef void const *gconstpointer;
typedef double gdouble;
typedef size_t gsize;
typedef ptrdiff_t gssize;
typedef uint32_t gunichar;
typedef int32_t gint32;
typedef uint32_t guint32;
typedef uint8_t guint8;
struct GError
{
    int code;
    gchar *message;
};

#ifndef TRUE
#define TRUE 1
#define FALSE 0
#endif
#ifndef CLAMP
#define CLAMP(x, low, high) (((x) > (high)) ? (high) : (((x) < (low)) ? (low) : (x)))
#endif
#ifndef MIN
#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
#endif
#ifndef ABS
#define ABS(a) (((a) < 0) ? -(a) : (a))
#endif

#define g_malloc(n) std::malloc(n)
#define g_free(p) std::free((void *)(p))
#define g_new(T, n) static_cast<T *>(std::malloc(sizeof(T) * (n)))
#define g_assert(x) assert(x)
#define g_assert_not_reached() assert(false)
#define g_warning(...) (std::fprintf(stderr, __VA_ARGS__), std::fputc('\n', stderr))
#define g_message(...) (std::fprintf(stderr, __VA_ARGS__), std::fputc('\n', stderr))
#define g_critical(...) (std::fprintf(stderr, __VA_ARGS__), std::fputc('\n', stderr))
#define g_print(...) std::fprintf(stderr, __VA_ARGS__)
#define g_error(...) (std::fprintf(stderr, __VA_ARGS__), std::abort())
#define g_return_if_fail(x) \
    do {                    \
        if (!(x))           \
            return;         \
    } while (0)
#define g_return_val_if_fail(x, v) \
    do {                           \
        if (!(x))                  \
            return (v);            \
    } while (0)

inline gchar *g_strdup(gchar const *s)
{
    return s ? strdup(s) : nullptr;
}
inline gchar *g_strdup_printf(gchar const *format, ...)
{
    va_list args;
    va_start(args, format);
    gchar *out = nullptr;
    if (vasprintf(&out, format, args) < 0)
        out = nullptr;
    va_end(args);
    return out;
}
inline gboolean g_ascii_isspace(gchar c)
{
    return std::isspace(static_cast<unsigned char>(c));
}
inline gboolean g_ascii_iscntrl(gchar c)
{
    return std::iscntrl(static_cast<unsigned char>(c));
}
inline gint g_ascii_strncasecmp(gchar const *a, gchar const *b, gsize n)
{
    return strncasecmp(a, b, n);
}
inline gint g_ascii_strcasecmp(gchar const *a, gchar const *b)
{
    return strcasecmp(a, b);
}
inline gchar *g_strrstr(gchar const *haystack, gchar const *needle)
{
    gchar const *found = nullptr;
    for (gchar const *p = std::strstr(haystack, needle); p; p = std::strstr(p + 1, needle))
        found = p;
    return const_cast<gchar *>(found);
}
inline gchar *g_path_get_basename(gchar const *path)
{
    gchar const *slash = std::strrchr(path, '/');
    return g_strdup(slash ? slash + 1 : path);
}
/** Encode as UTF-8 (at most 6 bytes); returns the number of bytes. */
inline gint g_unichar_to_utf8(gunichar c, gchar *out)
{
    gchar buf[6];
    gchar *o = out ? out : buf;
    if (c < 0x80) {
        o[0] = c;
        return 1;
    }
    if (c < 0x800) {
        o[0] = 0xc0 | (c >> 6);
        o[1] = 0x80 | (c & 0x3f);
        return 2;
    }
    if (c < 0x10000) {
        o[0] = 0xe0 | (c >> 12);
        o[1] = 0x80 | ((c >> 6) & 0x3f);
        o[2] = 0x80 | (c & 0x3f);
        return 3;
    }
    o[0] = 0xf0 | (c >> 18);
    o[1] = 0x80 | ((c >> 12) & 0x3f);
    o[2] = 0x80 | ((c >> 6) & 0x3f);
    o[3] = 0x80 | (c & 0x3f);
    return 4;
}
/** Whether str (length max_len, or NUL-terminated if -1) is valid UTF-8. */
inline gboolean g_utf8_validate(gchar const *str, gssize max_len, gchar const **end)
{
    auto p = reinterpret_cast<unsigned char const *>(str);
    auto stop = max_len < 0 ? nullptr : p + max_len;
    while (stop ? p < stop : *p) {
        int n = *p < 0x80 ? 0 : (*p >> 5) == 6 ? 1 : (*p >> 4) == 14 ? 2 : (*p >> 3) == 30 ? 3 : -1;
        if (n < 0)
            break;
        int i = 1;
        for (; i <= n; i++) {
            if ((stop && p + i >= stop) || (p[i] & 0xc0) != 0x80)
                break;
        }
        if (i <= n)
            break;
        p += n + 1;
    }
    if (end)
        *end = reinterpret_cast<gchar const *>(p);
    return stop ? p == stop : *p == 0;
}
inline gchar *g_base64_encode(guchar const *data, gsize len)
{
    static char const table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    gchar *out = static_cast<gchar *>(std::malloc((len + 2) / 3 * 4 + 1));
    gsize o = 0;
    for (gsize i = 0; i < len; i += 3) {
        uint32_t v = data[i] << 16 | (i + 1 < len ? data[i + 1] << 8 : 0) | (i + 2 < len ? data[i + 2] : 0);
        out[o++] = table[v >> 18];
        out[o++] = table[(v >> 12) & 63];
        out[o++] = i + 1 < len ? table[(v >> 6) & 63] : '=';
        out[o++] = i + 2 < len ? table[v & 63] : '=';
    }
    out[o] = 0;
    return out;
}
inline gdouble g_ascii_strtod(gchar const *nptr, gchar **endptr)
{
    return std::strtod(nptr, endptr);
}
inline gboolean g_str_equal(gconstpointer a, gconstpointer b)
{
    return std::strcmp(static_cast<gchar const *>(a), static_cast<gchar const *>(b)) == 0;
}
inline gchar *g_ascii_formatd(gchar *buffer, gint buf_len, gchar const *format, gdouble d)
{
    std::snprintf(buffer, buf_len, format, d);
    return buffer;
}
/** Character set conversion: only UTF-16 (BE, LE or with BOM) to UTF-8, which the PDF import uses. */
inline gchar *g_convert(gchar const *str, gssize len, gchar const *to, gchar const *from, gsize *, gsize *written,
                        GError **)
{
    if (std::strcmp(to, "UTF-8") != 0 || std::strncmp(from, "UTF-16", 6) != 0)
        return nullptr;
    auto p = reinterpret_cast<unsigned char const *>(str);
    gsize n = len < 0 ? 0 : gsize(len);
    bool le = std::strcmp(from, "UTF-16LE") == 0;
    if (std::strcmp(from, "UTF-16") == 0 && n >= 2 && ((p[0] == 0xff && p[1] == 0xfe) || (p[0] == 0xfe && p[1] == 0xff))) {
        le = p[0] == 0xff;
        p += 2;
        n -= 2;
    }
    gchar *out = static_cast<gchar *>(std::malloc(n * 2 + 1));
    gsize o = 0;
    for (gsize i = 0; i + 1 < n; i += 2) {
        gunichar c = le ? (p[i] | p[i + 1] << 8) : (p[i] << 8 | p[i + 1]);
        if (c >= 0xd800 && c < 0xdc00 && i + 3 < n) {
            gunichar c2 = le ? (p[i + 2] | p[i + 3] << 8) : (p[i + 2] << 8 | p[i + 3]);
            c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
            i += 2;
        }
        o += g_unichar_to_utf8(c, out + o);
    }
    out[o] = 0;
    if (written)
        *written = o;
    return out;
}
