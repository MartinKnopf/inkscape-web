// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-marker.cpp, src/object/sp-shape.cpp (get_markers, marker views)
import { type Affine, Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { FakeDrawing, type FakeDrawingItem } from '../display/fake-drawing.ts';
import { SPDocument } from '../document.ts';
import { SPMarkerLoc } from '../style.ts';
import { SP_ITEM_SHOW_DISPLAY, SPItem } from './sp-item.ts';
import type { SPMarker } from './sp-marker.ts';
import type { SPShape } from './sp-shape.ts';

SPDocument.scheduleIdle = () => {}; // tests call ensureUpToDate() themselves

function open(defs: string, body: string) {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs>${defs}</defs>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return { doc, get: <T>(id: string) => doc.getObjectById(id) as T };
}

/** Position and rotation (degrees) of a marker transform. */
function pose(m: Affine) {
  const p = new Point(0, 0).transformed(m);
  const x = new Point(1, 0).transformed(m).sub(p);
  return { x: p.x, y: p.y, angle: (Math.atan2(x.y, x.x) * 180) / Math.PI, scale: Math.hypot(x.x, x.y) };
}

const ARROW = (id: string, extra = '') =>
  `<marker id="${id}" ${extra}><path d="M 0,-1 L 2,0 L 0,1 Z"/></marker>`;

describe('SPShape.get_markers', () => {
  it('places start, mid and end markers on the nodes, oriented along the path with orient=auto', () => {
    const { get } = open(
      ARROW('m', 'orient="auto"'),
      '<path id="p" d="M 0,0 L 10,0 L 10,10" style="stroke:#000;stroke-width:1;marker-start:url(#m);marker-mid:url(#m);marker-end:url(#m)"/>',
    );
    const markers = get<SPShape>('p').get_markers();
    expect(markers.map(([loc]) => loc)).toEqual([
      SPMarkerLoc.SP_MARKER_LOC_START,
      SPMarkerLoc.SP_MARKER_LOC_MID,
      SPMarkerLoc.SP_MARKER_LOC_END,
    ]);
    const poses = markers.map(([, , m]) => pose(m));
    expect(poses[0]).toMatchObject({ x: 0, y: 0, angle: 0 });
    // The mid marker takes the average direction of the two segments.
    expect(poses[1]?.x).toBeCloseTo(10);
    expect(poses[1]?.angle).toBeCloseTo(45);
    expect(poses[2]?.y).toBeCloseTo(10);
    expect(poses[2]?.angle).toBeCloseTo(90);
  });

  it('reverses the start marker with auto-start-reverse and uses a fixed angle otherwise', () => {
    const { get } = open(
      ARROW('r', 'orient="auto-start-reverse"') + ARROW('f', 'orient="30"'),
      '<path id="p" d="M 0,0 C 0,10 10,10 10,0" style="stroke:#000;marker-start:url(#r);marker-end:url(#f)"/>',
    );
    const [start, end] = get<SPShape>('p')
      .get_markers()
      .map(([, , m]) => pose(m));
    // The curve starts downwards (90°): reversed, the start marker points up.
    expect(start?.angle).toBeCloseTo(-90);
    expect(end?.angle).toBeCloseTo(30);
    expect(end?.x).toBeCloseTo(10);
  });

  it('scales with the stroke width for markerUnits=strokeWidth only', () => {
    const { get } = open(
      ARROW('s', 'orient="auto"') + ARROW('u', 'orient="auto" markerUnits="userSpaceOnUse"'),
      '<path id="p" d="M 0,0 L 10,0" style="stroke:#000;stroke-width:3;marker-start:url(#s);marker-end:url(#u)"/>',
    );
    const [start, end] = get<SPShape>('p')
      .get_markers()
      .map(([, , m]) => pose(m));
    expect(start?.scale).toBeCloseTo(3);
    expect(end?.scale).toBeCloseTo(1);
  });

  it('puts mid markers on every node except the first and last, including subpath starts', () => {
    const { get } = open(
      ARROW('m'),
      '<path id="p" d="M 0,0 H 10 H 20 M 0,10 H 10" style="marker-mid:url(#m)"/>',
    );
    const shape = get<SPShape>('p');
    expect(shape.numberOfMarkers(SPMarkerLoc.SP_MARKER_LOC_MID)).toBe(3);
    const mids = shape.get_markers().map(([, , m]) => pose(m));
    expect(mids.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [10, 0],
      [20, 0],
      [0, 10],
    ]);
  });
});

describe('SPMarker', () => {
  it('maps the viewBox to markerWidth/markerHeight and moves refX/refY to the origin', () => {
    const { get } = open(
      '<marker id="m" viewBox="0 0 10 10" markerWidth="5" markerHeight="5" refX="10" refY="5"><path d="M 0,0 L 10,5 L 0,10 Z"/></marker>',
      '<path d="M 0,0 H 10" style="marker-end:url(#m)"/>',
    );
    const c2p = get<SPMarker>('m').c2p;
    // (refX, refY) = (10, 5) in viewBox units goes to the vertex.
    const ref = new Point(10, 5).transformed(c2p);
    expect(ref.x).toBeCloseTo(0);
    expect(ref.y).toBeCloseTo(0);
    expect(new Point(0, 0).transformed(c2p).x).toBeCloseTo(-5);
  });

  it('adds the markers to the visual bounds of the shape', () => {
    const { get } = open(
      ARROW('m', 'orient="auto" markerUnits="userSpaceOnUse"'),
      '<path id="p" d="M 0,0 H 10" style="stroke:none;marker-end:url(#m)"/>',
    );
    const shape = get<SPShape>('p');
    const box = shape.visualBounds();
    expect([box?.left(), box?.top(), box?.right(), box?.bottom()]).toEqual([0, -1, 12, 1]);
    expect(shape.geometricBounds()?.right()).toBe(10);
  });

  it('shows one instance group per marker as children of the shape view, with the marker transform', () => {
    const { doc, get } = open(
      ARROW('m', 'orient="auto"'),
      '<path id="p" d="M 0,0 H 10 V 10" style="stroke:#000;marker-start:url(#m);marker-end:url(#m)"/>',
    );
    const shape = get<SPShape>('p');
    const ai = shape.invokeShow(
      new FakeDrawing(),
      SPItem.displayKeyNew(1),
      SP_ITEM_SHOW_DISPLAY,
    ) as FakeDrawingItem;
    expect(ai.children.length).toBe(2);
    const end = ai.children[1];
    expect(end?.transform && pose(end.transform).angle).toBeCloseTo(90);
    expect(ai.childrenContextStyle).toBe(shape.style);

    shape.setAttribute('style', 'stroke:#000;marker-start:url(#m)');
    doc.ensureUpToDate();
    expect(ai.children.length).toBe(1);
    expect(get<SPMarker>('m').views_map.size).toBe(1);
  });
});
