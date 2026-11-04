// SPDX-License-Identifier: GPL-2.0-or-later
// The deleters declared in complete-deleters.h.
#include "Array.h"
#include "Dict.h"

void std::default_delete<Array>::operator()(Array *p) const noexcept
{
    delete p;
}

void std::default_delete<Dict>::operator()(Dict *p) const noexcept
{
    delete p;
}
