/** Applying the hooks the check resolved on their prototypes, and removing them. */

import type {Plan} from './check.js';
import {hookFor} from './hooks.js';

/** The property a hook holds its original under, which tells a hooked method. */
export const ORIGINAL = Symbol.for('a2ui-spectra-instrumentation.original');

/** Each method hooked, on its prototype, with its own descriptor there or none when it was inherited. */
const applied: Array<{
  prototype: object;
  method: string;
  own: PropertyDescriptor | undefined;
}> = [];

/** Hooks every name of the plan; on a failure, removes what it hooked and throws. */
export function apply(plan: Plan): void {
  try {
    for (const {hook, prototype} of plan.targets) {
      const own = Object.getOwnPropertyDescriptor(prototype, hook.method);
      const original = (prototype as Record<string, unknown>)[hook.method] as (
        this: unknown,
        ...args: unknown[]
      ) => unknown;
      const hooked = hookFor(hook.role, original);
      Object.defineProperty(hooked, ORIGINAL, {value: original});
      Object.defineProperty(prototype, hook.method, {
        value: hooked,
        writable: own?.writable ?? true,
        enumerable: own?.enumerable ?? false,
        configurable: true,
      });
      applied.push({prototype, method: hook.method, own});
    }
  } catch (error) {
    remove();
    throw error;
  }
}

/** Puts every original back: an own method as it was, an inherited one by deleting the hook. */
export function remove(): void {
  for (let entry = applied.pop(); entry !== undefined; entry = applied.pop()) {
    if (entry.own !== undefined) {
      Object.defineProperty(entry.prototype, entry.method, entry.own);
    } else {
      delete (entry.prototype as Record<string, unknown>)[entry.method];
    }
  }
}
