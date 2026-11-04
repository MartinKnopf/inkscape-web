// SPDX-License-Identifier: GPL-2.0-or-later
// Minimal Pango shim: PangoLogAttr for libnrtype/Layout-TNG.h (the scanline makers).
#pragma once
struct PangoLogAttr
{
    unsigned is_line_break : 1;
    unsigned is_mandatory_break : 1;
    unsigned is_char_break : 1;
    unsigned is_white : 1;
    unsigned is_cursor_position : 1;
    unsigned is_word_start : 1;
    unsigned is_word_end : 1;
    unsigned is_sentence_boundary : 1;
    unsigned is_sentence_start : 1;
    unsigned is_sentence_end : 1;
    unsigned backspace_deletes_character : 1;
    unsigned is_expandable_space : 1;
    unsigned is_word_boundary : 1;
    unsigned break_inserts_hyphen : 1;
    unsigned break_removes_preceding : 1;
    unsigned reserved : 17;
};
