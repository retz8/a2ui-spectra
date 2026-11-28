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

/** A class's guard: the handlers given and not stopped, the latest last, and the update it wraps. */
interface GuardState {
  handlers: OnFailure[];
  update: () => unknown;
  /** Whether the class's prototype held the update itself, rather than inheriting it. */
  ownUpdate: boolean;
}

type Guarded = UpdatingElementClass['prototype'] & {[GUARDED]?: GuardState};

/**
 * Guards the updates of a class's instances, its subclasses' included: a
 * throw is reported to the latest handler given for that class and not
 * stopped, and handed on to the console. Returns the way to stop this
 * handler; once every handler given is stopped, the class updates as it did
 * before, its throws its own again.
 */
export function guardElementUpdates(
  elementClass: UpdatingElementClass,
  onFailure: OnFailure,
): () => void {
  const prototype = elementClass.prototype as Guarded;
  let state = Object.prototype.hasOwnProperty.call(prototype, GUARDED)
    ? prototype[GUARDED]
    : undefined;
  if (state === undefined) {
    const guard: GuardState = {
      handlers: [],
      update: prototype.performUpdate,
      ownUpdate: Object.prototype.hasOwnProperty.call(prototype, 'performUpdate'),
    };
    Object.defineProperty(prototype, GUARDED, {value: guard, configurable: true});
    prototype.performUpdate = function (this: unknown) {
      try {
        return guard.update.call(this);
      } catch (error) {
        const handler = guard.handlers.at(-1);
        if (handler === undefined) throw error;
        console.error(error);
        handler(this, error);
        return undefined;
      }
    };
    state = guard;
  }
  const guard = state;
  guard.handlers.push(onFailure);
  return () => {
    const index = guard.handlers.lastIndexOf(onFailure);
    if (index === -1) return;
    guard.handlers.splice(index, 1);
    if (guard.handlers.length > 0) return;
    if (guard.ownUpdate) prototype.performUpdate = guard.update;
    else delete (prototype as Partial<Guarded>).performUpdate;
    delete prototype[GUARDED];
  };
}
