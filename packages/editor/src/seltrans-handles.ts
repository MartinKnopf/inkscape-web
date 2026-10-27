// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/seltrans-handles.cpp, src/seltrans-handles.h
/*
 * Seltrans knots
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *
 * Copyright (C) 1999-2002 authors
 * Copyright (C) 2014 Authors
 */
import { SPAnchorType } from './enums.ts';

export enum SPSelTransType {
  HANDLE_STRETCH,
  HANDLE_SCALE,
  HANDLE_SKEW,
  HANDLE_ROTATE,
  HANDLE_CENTER,
  HANDLE_SIDE_ALIGN,
  HANDLE_CORNER_ALIGN,
  HANDLE_CENTER_ALIGN,
}

/**
 * A handle of SelTrans. x and y are its position relative to the bounding
 * box (0 to 1, y up); control is the image index in upstream.
 */
export interface SPSelTransHandle {
  type: SPSelTransType;
  anchor: SPAnchorType;
  control: number;
  x: number;
  y: number;
}

const { HANDLE_CENTER, HANDLE_SCALE, HANDLE_STRETCH, HANDLE_ROTATE, HANDLE_SKEW } = SPSelTransType;
const { HANDLE_SIDE_ALIGN, HANDLE_CENTER_ALIGN, HANDLE_CORNER_ALIGN } = SPSelTransType;
const { SP_ANCHOR_CENTER, SP_ANCHOR_SE, SP_ANCHOR_S, SP_ANCHOR_SW, SP_ANCHOR_W } = SPAnchorType;
const { SP_ANCHOR_NW, SP_ANCHOR_N, SP_ANCHOR_NE, SP_ANCHOR_E } = SPAnchorType;

// biome-ignore format: table
export const hands: readonly SPSelTransHandle[] = [
  //center handle will be 0 so we can reference it quickly.
  { type: HANDLE_CENTER,       anchor: SP_ANCHOR_CENTER, control: 12, x: 0.5, y: 0.5 },
  //handle-type                anchor-nudge              image        x       y
  { type: HANDLE_SCALE,        anchor: SP_ANCHOR_SE,     control: 0,  x: 0,   y: 1   },
  { type: HANDLE_STRETCH,      anchor: SP_ANCHOR_S,      control: 3,  x: 0.5, y: 1   },
  { type: HANDLE_SCALE,        anchor: SP_ANCHOR_SW,     control: 1,  x: 1,   y: 1   },
  { type: HANDLE_STRETCH,      anchor: SP_ANCHOR_W,      control: 2,  x: 1,   y: 0.5 },
  { type: HANDLE_SCALE,        anchor: SP_ANCHOR_NW,     control: 0,  x: 1,   y: 0   },
  { type: HANDLE_STRETCH,      anchor: SP_ANCHOR_N,      control: 3,  x: 0.5, y: 0   },
  { type: HANDLE_SCALE,        anchor: SP_ANCHOR_NE,     control: 1,  x: 0,   y: 0   },
  { type: HANDLE_STRETCH,      anchor: SP_ANCHOR_E,      control: 2,  x: 0,   y: 0.5 },
  { type: HANDLE_ROTATE,       anchor: SP_ANCHOR_SE,     control: 4,  x: 0,   y: 1   },
  { type: HANDLE_SKEW,         anchor: SP_ANCHOR_S,      control: 8,  x: 0.5, y: 1   },
  { type: HANDLE_ROTATE,       anchor: SP_ANCHOR_SW,     control: 5,  x: 1,   y: 1   },
  { type: HANDLE_SKEW,         anchor: SP_ANCHOR_W,      control: 9,  x: 1,   y: 0.5 },
  { type: HANDLE_ROTATE,       anchor: SP_ANCHOR_NW,     control: 6,  x: 1,   y: 0   },
  { type: HANDLE_SKEW,         anchor: SP_ANCHOR_N,      control: 10, x: 0.5, y: 0   },
  { type: HANDLE_ROTATE,       anchor: SP_ANCHOR_NE,     control: 7,  x: 0,   y: 0   },
  { type: HANDLE_SKEW,         anchor: SP_ANCHOR_E,      control: 11, x: 0,   y: 0.5 },

  { type: HANDLE_SIDE_ALIGN,   anchor: SP_ANCHOR_S,      control: 13, x: 0.5, y: 1   },
  { type: HANDLE_SIDE_ALIGN,   anchor: SP_ANCHOR_W,      control: 14, x: 1,   y: 0.5 },
  { type: HANDLE_SIDE_ALIGN,   anchor: SP_ANCHOR_N,      control: 15, x: 0.5, y: 0   },
  { type: HANDLE_SIDE_ALIGN,   anchor: SP_ANCHOR_E,      control: 16, x: 0,   y: 0.5 },
  { type: HANDLE_CENTER_ALIGN, anchor: SP_ANCHOR_CENTER, control: 17, x: 0.5, y: 0.5 },
  { type: HANDLE_CORNER_ALIGN, anchor: SP_ANCHOR_SE,     control: 18, x: 0,   y: 1   },
  { type: HANDLE_CORNER_ALIGN, anchor: SP_ANCHOR_SW,     control: 19, x: 1,   y: 1   },
  { type: HANDLE_CORNER_ALIGN, anchor: SP_ANCHOR_NW,     control: 20, x: 1,   y: 0   },
  { type: HANDLE_CORNER_ALIGN, anchor: SP_ANCHOR_NE,     control: 21, x: 0,   y: 0   },
];
