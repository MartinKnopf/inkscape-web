// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/transformation.cpp, src/ui/dialog/transformation.h
/*
 * Transform dialog.
 *
 * Authors:
 *   Bryce W. Harrington <bryce@bryceharrington.org>
 *   buliabyak@gmail.com
 *   Abhishek Sharma
 *
 * Copyright (C) 2004, 2005 Authors
 */
import { _, C_, DEG, DocumentUndo, Preferences, Signal, UnitType } from '@inkscape-web/core';
import { Affine } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import {
  SkewUnits,
  transform_apply_matrix,
  transform_move,
  transform_rotate,
  transform_scale,
  transform_skew,
} from '../../util/transform-objects.ts';
import { ScalarUnit, UnitMenu } from '../widget/scalar-unit.ts';

/** The tabs of the dialog (upstream Transformation::PageType). */
export enum PageType {
  PAGE_MOVE,
  PAGE_SCALE,
  PAGE_ROTATE,
  PAGE_SKEW,
  PAGE_TRANSFORM,
}

const APPLY_SEPARATELY = '/dialogs/transformation/applyseparately';
const ROTATE_COUNTERCLOCKWISE = '/dialogs/transformation/rotateCounterClockwise';
const ICON = 'dialog-transform';

/**
 * The state and the actions of the Transform dialog for one desktop. The
 * view changes the fields, calls the on*() method of the change, and
 * re-renders on `changed`.
 */
export class Transformation {
  readonly changed = new Signal<[]>();
  page = PageType.PAGE_MOVE;

  readonly unitsMove = new UnitMenu(UnitType.LINEAR);
  readonly moveHorizontal = new ScalarUnit(this.unitsMove);
  readonly moveVertical = new ScalarUnit(this.unitsMove);
  moveRelative = true;

  readonly unitsScale = new UnitMenu(UnitType.DIMENSIONLESS, UnitType.LINEAR);
  readonly scaleHorizontal = new ScalarUnit(this.unitsScale);
  readonly scaleVertical = new ScalarUnit(this.unitsScale);
  scaleProportional = false;

  readonly unitsRotate = new UnitMenu(UnitType.RADIAL);
  readonly rotate = new ScalarUnit(this.unitsRotate);

  readonly unitsSkew = new UnitMenu(UnitType.LINEAR, UnitType.DIMENSIONLESS, UnitType.RADIAL);
  readonly skewHorizontal = new ScalarUnit(this.unitsSkew);
  readonly skewVertical = new ScalarUnit(this.unitsSkew);

  /** The matrix elements A to D, and E and F in the unit of unitsTransform. */
  readonly matrix = [1, 0, 0, 1, 0, 0];
  readonly unitsTransform = new UnitMenu(UnitType.LINEAR);
  replaceMatrix = false;

  /** The rotation direction buttons: true is counterclockwise. */
  counterclockwise: boolean;

  /** The last refused operation, shown in the dialog (upstream: the message stack). */
  message = '';

  constructor(readonly desktop: SPDesktop) {
    for (const s of [this.scaleHorizontal, this.scaleVertical]) {
      s.value = 100;
      s.absoluteIsIncrement = true;
      s.percentageIsIncrement = true;
    }
    this.unitsScale.setUnit('%');
    this.scaleHorizontal.value = this.scaleVertical.value = 100;
    // Default unit is the document unit.
    const unit = desktop.doc.getNamedView().getDisplayUnit();
    if (this.unitsMove.units.includes(unit)) {
      this.unitsMove.setUnit(unit);
      this.unitsTransform.setUnit(unit);
    }
    const prefs = Preferences.get();
    const yaxisdown = desktop.yaxisdir() > 0;
    this.counterclockwise = prefs.getBool(ROTATE_COUNTERCLOCKWISE, true) !== yaxisdown;
    this.setRotateDirection(this.counterclockwise);
    this.unitsRotate.setUnit(DEG);
    this.unitsSkew.setUnit(DEG);
    this.updateSelection(PageType.PAGE_MOVE);
  }

  get applySeparately(): boolean {
    return Preferences.get().getBool(APPLY_SEPARATELY);
  }

  /** upstream onApplySeparatelyToggled */
  set applySeparately(value: boolean) {
    Preferences.get().setBool(APPLY_SEPARATELY, value);
    this.changed.emit();
  }

  get hasSelection(): boolean {
    return !this.desktop.getSelection().isEmpty();
  }

  /** "Apply to each object separately" is shown for more than one object. */
  get showApplySeparately(): boolean {
    return this.desktop.getSelection().size() > 1;
  }

  /** The matrix of the fields, with E and F in px (upstream getCurrentMatrix). */
  getCurrentMatrix(): Affine {
    const [a, b, c, d, e, f] = this.matrix as [number, number, number, number, number, number];
    const toPx = this.unitsTransform.getConversion('px');
    return new Affine(a, b, c, d, e * toPx, f * toPx);
  }

  #setMatrix(m: Affine): void {
    const fromPx = this.unitsTransform.getConversion('px');
    this.matrix.splice(0, 6, m.c0, m.c1, m.c2, m.c3, m.c4 / fromPx, m.c5 / fromPx);
  }

  setPage(page: PageType): void {
    this.page = page;
    this.updateSelection(page);
  }

  /** Update the fields of the page from the selection (upstream updateSelection). */
  updateSelection(page: PageType = this.page): void {
    const selection = this.desktop.getSelection();
    if (!selection.isEmpty()) {
      const bbox = selection.preferredBounds();
      switch (page) {
        case PageType.PAGE_MOVE:
          // A relative move keeps its values, to apply the same move to many objects in turn.
          if (!this.moveRelative && bbox) {
            this.moveHorizontal.value = this.moveHorizontal.fromPx(bbox.left());
            this.moveVertical.value = this.moveVertical.fromPx(bbox.top());
          }
          break;
        case PageType.PAGE_SCALE:
          if (bbox) {
            this.scaleHorizontal.hundredPercent = bbox.width();
            this.scaleVertical.hundredPercent = bbox.height();
            this.onScaleXValueChanged(); // update the proportion if it is on
          }
          break;
        case PageType.PAGE_SKEW:
          if (bbox) {
            this.skewVertical.hundredPercent = bbox.width();
            this.skewHorizontal.hundredPercent = bbox.height();
          }
          break;
        case PageType.PAGE_TRANSFORM: {
          // Without "Edit current matrix", the fields keep their values, to apply the same matrix to many objects.
          const first = selection.items()[0];
          if (this.replaceMatrix && first) this.#setMatrix(first.transform);
          break;
        }
        case PageType.PAGE_ROTATE:
          break;
      }
    }
    this.changed.emit();
  }

  // Apply

  /** Apply the page to the selection, to a duplicate of it if duplicateFirst (upstream _apply). */
  apply(duplicateFirst: boolean): void {
    const selection = this.desktop.getSelection();
    if (selection.isEmpty()) return;
    this.message = '';
    const doc = this.desktop.doc;
    const done = (description: string) => DocumentUndo.done(doc, description, ICON);
    const separately = this.applySeparately;
    const prefs = Preferences.get();

    switch (this.page) {
      case PageType.PAGE_TRANSFORM: {
        const displayed = this.getCurrentMatrix(); // read the values before the selection changes
        if (displayed.isSingular()) {
          this.#flash(_('Transform matrix is singular, <b>not used</b>.'));
          break;
        }
        if (duplicateFirst) selection.duplicate();
        transform_apply_matrix(selection, displayed, this.replaceMatrix);
        done(C_('Undo', 'Edit transformation matrix'));
        break;
      }
      case PageType.PAGE_MOVE: {
        if (duplicateFirst) selection.duplicate();
        const x = this.moveHorizontal.getValue('px');
        const y = this.moveVertical.getValue('px');
        transform_move(selection, x, y, this.moveRelative, separately, this.desktop.yaxisdir());
        done(C_('Undo', 'Move'));
        break;
      }
      case PageType.PAGE_SCALE: {
        if (duplicateFirst) selection.duplicate();
        const transformStroke = prefs.getBool('/options/transform/stroke', true);
        const preserve = prefs.getBool('/options/preservetransform/value', false);
        transform_scale(
          selection,
          this.scaleHorizontal.getValue('px'),
          this.scaleVertical.getValue('px'),
          !this.unitsScale.isAbsolute(),
          separately,
          transformStroke,
          preserve,
        );
        done(C_('Undo', 'Scale'));
        break;
      }
      case PageType.PAGE_ROTATE: {
        if (duplicateFirst) selection.duplicate();
        let angle = this.rotate.getValue(DEG);
        if (!prefs.getBool(ROTATE_COUNTERCLOCKWISE, true)) angle *= -1;
        transform_rotate(selection, angle, separately);
        done(C_('Undo', 'Rotate'));
        break;
      }
      case PageType.PAGE_SKEW: {
        if (duplicateFirst) selection.duplicate();
        let units = SkewUnits.Absolute;
        let unit = 'px';
        if (!this.unitsSkew.isAbsolute()) [units, unit] = [SkewUnits.Percent, '%'];
        else if (this.unitsSkew.isRadial()) [units, unit] = [SkewUnits.AngleRadians, 'rad'];
        const ok = transform_skew(
          selection,
          this.skewHorizontal.getValue(unit),
          this.skewVertical.getValue(unit),
          units,
          separately,
          this.desktop.yaxisdir(),
          (m) => this.#flash(m),
        );
        if (ok) done(C_('Undo', 'Skew'));
        break;
      }
    }
    this.changed.emit();
  }

  #flash(message: string): void {
    this.message = message;
  }

  // Value-changed callbacks

  onMoveRelativeToggled(): void {
    const selection = this.desktop.getSelection();
    if (selection.isEmpty()) return;
    const x = this.moveHorizontal.getValue('px');
    const y = this.moveVertical.getValue('px');
    const conversion = this.unitsMove.getConversion('px');
    const bbox = selection.preferredBounds();
    if (bbox) {
      // Relative to absolute, or absolute to relative.
      const sign = this.moveRelative ? -1 : 1;
      this.moveHorizontal.value = (sign * bbox.left() + x) / conversion;
      this.moveVertical.value = (sign * bbox.top() + y) / conversion;
    }
    this.changed.emit();
  }

  onScaleXValueChanged(): void {
    if (!this.scaleProportional) return;
    if (!this.unitsScale.isAbsolute()) {
      // Percentage: copy it.
      this.scaleVertical.value = this.scaleHorizontal.getValue('%');
    } else {
      this.scaleVertical.setFromPercentage(this.scaleHorizontal.getAsPercentage());
    }
  }

  onScaleYValueChanged(): void {
    if (!this.scaleProportional) return;
    if (!this.unitsScale.isAbsolute()) {
      this.scaleHorizontal.value = this.scaleVertical.getValue('%');
    } else {
      this.scaleHorizontal.setFromPercentage(this.scaleVertical.getAsPercentage());
    }
  }

  onScaleProportionalToggled(): void {
    this.onScaleXValueChanged();
    this.changed.emit();
  }

  /** The direction buttons of the rotate page (upstream onRotate(Counter)ClockwiseClicked). */
  setRotateDirection(counterclockwise: boolean): void {
    this.counterclockwise = counterclockwise;
    const yaxisdown = this.desktop.yaxisdir() > 0;
    Preferences.get().setBool(ROTATE_COUNTERCLOCKWISE, counterclockwise ? !yaxisdown : yaxisdown);
    this.changed.emit();
  }

  onReplaceMatrixToggled(): void {
    const selection = this.desktop.getSelection();
    if (selection.isEmpty()) return;
    const first = selection.items()[0];
    if (!first) return;
    const current = first.transform; // from the first object of the selection
    this.#setMatrix(this.replaceMatrix ? current : current.inverse().multiply(this.getCurrentMatrix()));
    this.changed.emit();
  }

  /** Reset the values of the page (upstream onClear). */
  onClear(): void {
    switch (this.page) {
      case PageType.PAGE_MOVE: {
        const bbox = this.desktop.getSelection().preferredBounds();
        if (this.desktop.getSelection().isEmpty() || this.moveRelative || !bbox) {
          this.moveHorizontal.value = this.moveVertical.value = 0;
        } else {
          this.moveHorizontal.value = this.moveHorizontal.fromPx(bbox.left());
          this.moveVertical.value = this.moveVertical.fromPx(bbox.top());
        }
        break;
      }
      case PageType.PAGE_ROTATE:
        this.rotate.value = 0;
        break;
      case PageType.PAGE_SCALE:
        this.unitsScale.setUnit('%');
        this.scaleHorizontal.value = this.scaleVertical.value = 100;
        break;
      case PageType.PAGE_SKEW:
        this.skewHorizontal.value = this.skewVertical.value = 0;
        break;
      case PageType.PAGE_TRANSFORM:
        this.matrix.splice(0, 6, 1, 0, 0, 1, 0, 0);
        break;
    }
    this.changed.emit();
  }
}
