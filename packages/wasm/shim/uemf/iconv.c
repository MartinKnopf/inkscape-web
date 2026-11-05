/* SPDX-License-Identifier: GPL-2.0-or-later */
/* The iconv wrappers of shim/uemf/iconv.h: the target "LATIN1//TRANSLIT" (or
 * "ISO-8859-1//TRANSLIT") as glibc does it: Latin1 characters as they are, letters with
 * accents without them, some symbols in their ASCII forms ("…" -> "...", "€" -> "EUR") and '?'
 * for the rest. The other conversions are musl's.
 */
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <iconv.h> /* shim/uemf/iconv.h (on the include path), which includes musl iconv.h */

struct shim_cd {
    iconv_t inner; /* musl: the source to UTF-32LE (translit) or the whole conversion */
    int translit;
};

struct translit {
    unsigned int cp;
    const char *s;
};

/* Generated from the Unicode decompositions (U+0100-U+024F, U+1E00-U+1EFF: the base letters)
 * and the glibc translit tables (letters without decomposition, punctuation, symbols). */
static const struct translit table[] = {
    {0x0100, "A"}, {0x0101, "a"}, {0x0102, "A"}, {0x0103, "a"}, {0x0104, "A"},
    {0x0105, "a"}, {0x0106, "C"}, {0x0107, "c"}, {0x0108, "C"}, {0x0109, "c"},
    {0x010A, "C"}, {0x010B, "c"}, {0x010C, "C"}, {0x010D, "c"}, {0x010E, "D"},
    {0x010F, "d"}, {0x0110, "D"}, {0x0111, "d"}, {0x0112, "E"}, {0x0113, "e"},
    {0x0114, "E"}, {0x0115, "e"}, {0x0116, "E"}, {0x0117, "e"}, {0x0118, "E"},
    {0x0119, "e"}, {0x011A, "E"}, {0x011B, "e"}, {0x011C, "G"}, {0x011D, "g"},
    {0x011E, "G"}, {0x011F, "g"}, {0x0120, "G"}, {0x0121, "g"}, {0x0122, "G"},
    {0x0123, "g"}, {0x0124, "H"}, {0x0125, "h"}, {0x0126, "H"}, {0x0127, "h"},
    {0x0128, "I"}, {0x0129, "i"}, {0x012A, "I"}, {0x012B, "i"}, {0x012C, "I"},
    {0x012D, "i"}, {0x012E, "I"}, {0x012F, "i"}, {0x0130, "I"}, {0x0131, "i"},
    {0x0132, "IJ"}, {0x0133, "ij"}, {0x0134, "J"}, {0x0135, "j"}, {0x0136, "K"},
    {0x0137, "k"}, {0x0139, "L"}, {0x013A, "l"}, {0x013B, "L"}, {0x013C, "l"},
    {0x013D, "L"}, {0x013E, "l"}, {0x013F, "L"}, {0x0140, "l"}, {0x0141, "L"},
    {0x0142, "l"}, {0x0143, "N"}, {0x0144, "n"}, {0x0145, "N"}, {0x0146, "n"},
    {0x0147, "N"}, {0x0148, "n"}, {0x0149, "'n"}, {0x014C, "O"}, {0x014D, "o"},
    {0x014E, "O"}, {0x014F, "o"}, {0x0150, "O"}, {0x0151, "o"}, {0x0152, "OE"},
    {0x0153, "oe"}, {0x0154, "R"}, {0x0155, "r"}, {0x0156, "R"}, {0x0157, "r"},
    {0x0158, "R"}, {0x0159, "r"}, {0x015A, "S"}, {0x015B, "s"}, {0x015C, "S"},
    {0x015D, "s"}, {0x015E, "S"}, {0x015F, "s"}, {0x0160, "S"}, {0x0161, "s"},
    {0x0162, "T"}, {0x0163, "t"}, {0x0164, "T"}, {0x0165, "t"}, {0x0166, "T"},
    {0x0167, "t"}, {0x0168, "U"}, {0x0169, "u"}, {0x016A, "U"}, {0x016B, "u"},
    {0x016C, "U"}, {0x016D, "u"}, {0x016E, "U"}, {0x016F, "u"}, {0x0170, "U"},
    {0x0171, "u"}, {0x0172, "U"}, {0x0173, "u"}, {0x0174, "W"}, {0x0175, "w"},
    {0x0176, "Y"}, {0x0177, "y"}, {0x0178, "Y"}, {0x0179, "Z"}, {0x017A, "z"},
    {0x017B, "Z"}, {0x017C, "z"}, {0x017D, "Z"}, {0x017E, "z"}, {0x017F, "s"},
    {0x0180, "b"}, {0x0197, "I"}, {0x01A0, "O"}, {0x01A1, "o"}, {0x01AF, "U"},
    {0x01B0, "u"}, {0x01CD, "A"}, {0x01CE, "a"}, {0x01CF, "I"}, {0x01D0, "i"},
    {0x01D1, "O"}, {0x01D2, "o"}, {0x01D3, "U"}, {0x01D4, "u"}, {0x01D5, "U"},
    {0x01D6, "u"}, {0x01D7, "U"}, {0x01D8, "u"}, {0x01D9, "U"}, {0x01DA, "u"},
    {0x01DB, "U"}, {0x01DC, "u"}, {0x01DE, "A"}, {0x01DF, "a"}, {0x01E0, "A"},
    {0x01E1, "a"}, {0x01E2, "\xC6"}, {0x01E3, "\xE6"}, {0x01E6, "G"}, {0x01E7, "g"},
    {0x01E8, "K"}, {0x01E9, "k"}, {0x01EA, "O"}, {0x01EB, "o"}, {0x01EC, "O"},
    {0x01ED, "o"}, {0x01F0, "j"}, {0x01F4, "G"}, {0x01F5, "g"}, {0x01F8, "N"},
    {0x01F9, "n"}, {0x01FA, "A"}, {0x01FB, "a"}, {0x01FC, "\xC6"}, {0x01FD, "\xE6"},
    {0x01FE, "\xD8"}, {0x01FF, "\xF8"}, {0x0200, "A"}, {0x0201, "a"}, {0x0202, "A"},
    {0x0203, "a"}, {0x0204, "E"}, {0x0205, "e"}, {0x0206, "E"}, {0x0207, "e"},
    {0x0208, "I"}, {0x0209, "i"}, {0x020A, "I"}, {0x020B, "i"}, {0x020C, "O"},
    {0x020D, "o"}, {0x020E, "O"}, {0x020F, "o"}, {0x0210, "R"}, {0x0211, "r"},
    {0x0212, "R"}, {0x0213, "r"}, {0x0214, "U"}, {0x0215, "u"}, {0x0216, "U"},
    {0x0217, "u"}, {0x0218, "S"}, {0x0219, "s"}, {0x021A, "T"}, {0x021B, "t"},
    {0x021E, "H"}, {0x021F, "h"}, {0x0226, "A"}, {0x0227, "a"}, {0x0228, "E"},
    {0x0229, "e"}, {0x022A, "O"}, {0x022B, "o"}, {0x022C, "O"}, {0x022D, "o"},
    {0x022E, "O"}, {0x022F, "o"}, {0x0230, "O"}, {0x0231, "o"}, {0x0232, "Y"},
    {0x0233, "y"}, {0x1E00, "A"}, {0x1E01, "a"}, {0x1E02, "B"}, {0x1E03, "b"},
    {0x1E04, "B"}, {0x1E05, "b"}, {0x1E06, "B"}, {0x1E07, "b"}, {0x1E08, "C"},
    {0x1E09, "c"}, {0x1E0A, "D"}, {0x1E0B, "d"}, {0x1E0C, "D"}, {0x1E0D, "d"},
    {0x1E0E, "D"}, {0x1E0F, "d"}, {0x1E10, "D"}, {0x1E11, "d"}, {0x1E12, "D"},
    {0x1E13, "d"}, {0x1E14, "E"}, {0x1E15, "e"}, {0x1E16, "E"}, {0x1E17, "e"},
    {0x1E18, "E"}, {0x1E19, "e"}, {0x1E1A, "E"}, {0x1E1B, "e"}, {0x1E1C, "E"},
    {0x1E1D, "e"}, {0x1E1E, "F"}, {0x1E1F, "f"}, {0x1E20, "G"}, {0x1E21, "g"},
    {0x1E22, "H"}, {0x1E23, "h"}, {0x1E24, "H"}, {0x1E25, "h"}, {0x1E26, "H"},
    {0x1E27, "h"}, {0x1E28, "H"}, {0x1E29, "h"}, {0x1E2A, "H"}, {0x1E2B, "h"},
    {0x1E2C, "I"}, {0x1E2D, "i"}, {0x1E2E, "I"}, {0x1E2F, "i"}, {0x1E30, "K"},
    {0x1E31, "k"}, {0x1E32, "K"}, {0x1E33, "k"}, {0x1E34, "K"}, {0x1E35, "k"},
    {0x1E36, "L"}, {0x1E37, "l"}, {0x1E38, "L"}, {0x1E39, "l"}, {0x1E3A, "L"},
    {0x1E3B, "l"}, {0x1E3C, "L"}, {0x1E3D, "l"}, {0x1E3E, "M"}, {0x1E3F, "m"},
    {0x1E40, "M"}, {0x1E41, "m"}, {0x1E42, "M"}, {0x1E43, "m"}, {0x1E44, "N"},
    {0x1E45, "n"}, {0x1E46, "N"}, {0x1E47, "n"}, {0x1E48, "N"}, {0x1E49, "n"},
    {0x1E4A, "N"}, {0x1E4B, "n"}, {0x1E4C, "O"}, {0x1E4D, "o"}, {0x1E4E, "O"},
    {0x1E4F, "o"}, {0x1E50, "O"}, {0x1E51, "o"}, {0x1E52, "O"}, {0x1E53, "o"},
    {0x1E54, "P"}, {0x1E55, "p"}, {0x1E56, "P"}, {0x1E57, "p"}, {0x1E58, "R"},
    {0x1E59, "r"}, {0x1E5A, "R"}, {0x1E5B, "r"}, {0x1E5C, "R"}, {0x1E5D, "r"},
    {0x1E5E, "R"}, {0x1E5F, "r"}, {0x1E60, "S"}, {0x1E61, "s"}, {0x1E62, "S"},
    {0x1E63, "s"}, {0x1E64, "S"}, {0x1E65, "s"}, {0x1E66, "S"}, {0x1E67, "s"},
    {0x1E68, "S"}, {0x1E69, "s"}, {0x1E6A, "T"}, {0x1E6B, "t"}, {0x1E6C, "T"},
    {0x1E6D, "t"}, {0x1E6E, "T"}, {0x1E6F, "t"}, {0x1E70, "T"}, {0x1E71, "t"},
    {0x1E72, "U"}, {0x1E73, "u"}, {0x1E74, "U"}, {0x1E75, "u"}, {0x1E76, "U"},
    {0x1E77, "u"}, {0x1E78, "U"}, {0x1E79, "u"}, {0x1E7A, "U"}, {0x1E7B, "u"},
    {0x1E7C, "V"}, {0x1E7D, "v"}, {0x1E7E, "V"}, {0x1E7F, "v"}, {0x1E80, "W"},
    {0x1E81, "w"}, {0x1E82, "W"}, {0x1E83, "w"}, {0x1E84, "W"}, {0x1E85, "w"},
    {0x1E86, "W"}, {0x1E87, "w"}, {0x1E88, "W"}, {0x1E89, "w"}, {0x1E8A, "X"},
    {0x1E8B, "x"}, {0x1E8C, "X"}, {0x1E8D, "x"}, {0x1E8E, "Y"}, {0x1E8F, "y"},
    {0x1E90, "Z"}, {0x1E91, "z"}, {0x1E92, "Z"}, {0x1E93, "z"}, {0x1E94, "Z"},
    {0x1E95, "z"}, {0x1E96, "h"}, {0x1E97, "t"}, {0x1E98, "w"}, {0x1E99, "y"},
    {0x1EA0, "A"}, {0x1EA1, "a"}, {0x1EA2, "A"}, {0x1EA3, "a"}, {0x1EA4, "A"},
    {0x1EA5, "a"}, {0x1EA6, "A"}, {0x1EA7, "a"}, {0x1EA8, "A"}, {0x1EA9, "a"},
    {0x1EAA, "A"}, {0x1EAB, "a"}, {0x1EAC, "A"}, {0x1EAD, "a"}, {0x1EAE, "A"},
    {0x1EAF, "a"}, {0x1EB0, "A"}, {0x1EB1, "a"}, {0x1EB2, "A"}, {0x1EB3, "a"},
    {0x1EB4, "A"}, {0x1EB5, "a"}, {0x1EB6, "A"}, {0x1EB7, "a"}, {0x1EB8, "E"},
    {0x1EB9, "e"}, {0x1EBA, "E"}, {0x1EBB, "e"}, {0x1EBC, "E"}, {0x1EBD, "e"},
    {0x1EBE, "E"}, {0x1EBF, "e"}, {0x1EC0, "E"}, {0x1EC1, "e"}, {0x1EC2, "E"},
    {0x1EC3, "e"}, {0x1EC4, "E"}, {0x1EC5, "e"}, {0x1EC6, "E"}, {0x1EC7, "e"},
    {0x1EC8, "I"}, {0x1EC9, "i"}, {0x1ECA, "I"}, {0x1ECB, "i"}, {0x1ECC, "O"},
    {0x1ECD, "o"}, {0x1ECE, "O"}, {0x1ECF, "o"}, {0x1ED0, "O"}, {0x1ED1, "o"},
    {0x1ED2, "O"}, {0x1ED3, "o"}, {0x1ED4, "O"}, {0x1ED5, "o"}, {0x1ED6, "O"},
    {0x1ED7, "o"}, {0x1ED8, "O"}, {0x1ED9, "o"}, {0x1EDA, "O"}, {0x1EDB, "o"},
    {0x1EDC, "O"}, {0x1EDD, "o"}, {0x1EDE, "O"}, {0x1EDF, "o"}, {0x1EE0, "O"},
    {0x1EE1, "o"}, {0x1EE2, "O"}, {0x1EE3, "o"}, {0x1EE4, "U"}, {0x1EE5, "u"},
    {0x1EE6, "U"}, {0x1EE7, "u"}, {0x1EE8, "U"}, {0x1EE9, "u"}, {0x1EEA, "U"},
    {0x1EEB, "u"}, {0x1EEC, "U"}, {0x1EED, "u"}, {0x1EEE, "U"}, {0x1EEF, "u"},
    {0x1EF0, "U"}, {0x1EF1, "u"}, {0x1EF2, "Y"}, {0x1EF3, "y"}, {0x1EF4, "Y"},
    {0x1EF5, "y"}, {0x1EF6, "Y"}, {0x1EF7, "y"}, {0x1EF8, "Y"}, {0x1EF9, "y"},
    {0x2002, " "}, {0x2003, " "}, {0x2007, " "}, {0x2008, " "}, {0x2009, " "},
    {0x200A, " "}, {0x2010, "-"}, {0x2011, "-"}, {0x2012, "-"}, {0x2013, "-"},
    {0x2014, "-"}, {0x2015, "-"}, {0x2018, "'"}, {0x2019, "'"}, {0x201A, "'"},
    {0x201B, "'"}, {0x201C, "\""}, {0x201D, "\""}, {0x201E, "\""}, {0x201F, "\""},
    {0x2020, "+"}, {0x2022, "o"}, {0x2026, "..."}, {0x202F, " "}, {0x2032, "'"},
    {0x2033, "\""}, {0x2039, "<"}, {0x203A, ">"}, {0x2044, "/"}, {0x20AC, "EUR"},
    {0x2122, "TM"}, {0x2190, "<-"}, {0x2192, "->"}, {0x2212, "-"}, {0x2215, "/"},
};

const char *shim_latin1_translit(unsigned int cp)
{
    size_t lo = 0, hi = sizeof(table) / sizeof(table[0]);
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (table[mid].cp == cp) {
            return table[mid].s;
        }
        if (table[mid].cp < cp) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return "";
}

static int is_translit_latin1(const char *tocode)
{
    return !strcmp(tocode, "LATIN1//TRANSLIT") || !strcmp(tocode, "ISO-8859-1//TRANSLIT");
}

iconv_t shim_iconv_open(const char *tocode, const char *fromcode)
{
    struct shim_cd *cd = malloc(sizeof(struct shim_cd));
    if (!cd) {
        return (iconv_t)-1;
    }
    cd->translit = is_translit_latin1(tocode);
    cd->inner = (iconv_open)(cd->translit ? "UTF-32LE" : tocode, fromcode);
    if (cd->inner == (iconv_t)-1) {
        free(cd);
        return (iconv_t)-1;
    }
    return (iconv_t)cd;
}

size_t shim_iconv(iconv_t handle, char **inbuf, size_t *inbytesleft, char **outbuf, size_t *outbytesleft)
{
    struct shim_cd *cd = (struct shim_cd *)handle;
    if (!cd->translit || !inbuf || !*inbuf) {
        return (iconv)(cd->inner, inbuf, inbytesleft, outbuf, outbytesleft);
    }
    /* to UTF-32LE first, then each code point to Latin1 */
    size_t cap = *inbytesleft * 4 + 4;
    char *u32 = malloc(cap);
    if (!u32) {
        errno = ENOMEM;
        return (size_t)-1;
    }
    char *p = u32;
    size_t left = cap;
    size_t status = (iconv)(cd->inner, inbuf, inbytesleft, &p, &left);
    size_t irreversible = 0;
    if (status != (size_t)-1) {
        for (char *c = u32; c < p; c += 4) {
            uint32_t cp = (uint32_t)(uint8_t)c[0] | (uint32_t)(uint8_t)c[1] << 8 | (uint32_t)(uint8_t)c[2] << 16 |
                          (uint32_t)(uint8_t)c[3] << 24;
            char one[2] = {(char)cp, 0};
            const char *s = one;
            size_t n = 1;
            if (cp > 0xFF) {
                irreversible++;
                if (cp >= 0x300 && cp <= 0x36F) {
                    n = 0; /* a combining mark: dropped */
                } else {
                    s = shim_latin1_translit(cp);
                    n = strlen(s);
                    if (!n) {
                        s = "?";
                        n = 1;
                    }
                }
            }
            if (n > *outbytesleft) {
                errno = E2BIG;
                status = (size_t)-1;
                break;
            }
            memcpy(*outbuf, s, n);
            *outbuf += n;
            *outbytesleft -= n;
        }
    }
    free(u32);
    return status == (size_t)-1 ? status : irreversible;
}

int shim_iconv_close(iconv_t handle)
{
    struct shim_cd *cd = (struct shim_cd *)handle;
    int r = (iconv_close)(cd->inner);
    free(cd);
    return r;
}
