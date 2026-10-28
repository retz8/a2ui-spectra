/**
 * A guard on a custom element class's updates, for components drawn as web
 * components, which an error boundary of the page's framework does not see.
 * A throw in an element's update is reported with the element and does not
 * leave the page; the element stays as its last update left it. Web core's
 * universal elements, which both basic catalogs are drawn with, share one
 * base class, so one guard covers them all.
 */

/** A class whose instances update as Lit's do. */
export interface UpdatingElementClass {
  prototype: {performUpdate(): unknown};
}

type OnFailure = (element: unknown, error: unknown) => void;

const GUARDED = Symbol.for('a2ui-spectra-preview.guarded');

interface Guarded {
  [GUARDED]?: {onFailure: OnFailure};
}

/**
 * Guards the updates of a class's instances, its subclasses' included,
 * reporting each throw to the latest handler given for that class.
 */
export function guardElementUpdates(
  elementClass: UpdatingElementClass,
  onFailure: OnFailure,
): void {
  const prototype = elementClass.prototype as UpdatingElementClass['prototype'] & Guarded;
  const existing = Object.prototype.hasOwnProperty.call(prototype, GUARDED)
    ? prototype[GUARDED]
    : undefined;
  if (existing !== undefined) {
    existing.onFailure = onFailure;
    return;
  }
  const state = {onFailure};
  const update = prototype.performUpdate;
  Object.defineProperty(prototype, GUARDED, {value: state});
  prototype.performUpdate = function (this: unknown) {
    try {
      return update.call(this);
    } catch (error) {
      state.onFailure(this, error);
      return undefined;
    }
  };
}
