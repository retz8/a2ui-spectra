/**
 * The values of a component that web core resolves at render time, found by
 * walking the component as the agent wrote it with web core's own behaviour
 * tree over the catalog entry's schema: its bindings, in dynamic positions,
 * in an action's context and user message, and inside a function call's
 * arguments; its function calls; and its templates, a child list drawn from
 * a data model list. Each comes with the JSON Pointer to it inside the
 * component.
 */
import type {ComponentApi} from '@a2ui/web_core/catalog';
import {type BehaviorNode, scrapeSchemaBehavior} from '@a2ui/web_core/resolution';

import {isObject} from './conversation.js';
import {token} from './pointers.js';

export type DynamicValue =
  | {kind: 'binding'; pointer: string; path: string}
  | {kind: 'call'; pointer: string; name: string; call: Record<string, unknown>}
  | {kind: 'template'; pointer: string; componentId: string; path: string};

/** The keys a protocol version writes a binding and a function call with. */
export interface DynamicKeys {
  path: string;
  call: string;
}

/** `@path` and `@call` from v1.0 on, `path` and `call` before. */
export function dynamicKeys(version: string | undefined): DynamicKeys {
  const v1 = version !== undefined && /^v?1\./.test(version);
  return v1 ? {path: '@path', call: '@call'} : {path: 'path', call: 'call'};
}

/** The component's dynamic values, in the order its properties are written. */
export function dynamicValues(
  component: Record<string, unknown>,
  api: ComponentApi,
  version: string | undefined,
): DynamicValue[] {
  const found: DynamicValue[] = [];
  walk(component, scrapeSchemaBehavior(api.schema), '', dynamicKeys(version), found);
  return found;
}

function walk(
  value: unknown,
  node: BehaviorNode,
  pointer: string,
  keys: DynamicKeys,
  found: DynamicValue[],
): void {
  switch (node.type) {
    case 'DYNAMIC':
      inspect(value, pointer, keys, found);
      return;
    case 'ACTION':
      if (!isObject(value)) return;
      if (isObject(value.event)) {
        if (isObject(value.event.context)) {
          for (const [key, item] of Object.entries(value.event.context)) {
            inspect(item, `${pointer}/event/context/${token(key)}`, keys, found);
          }
        }
        if ('userMessage' in value.event) {
          inspect(value.event.userMessage, `${pointer}/event/userMessage`, keys, found);
        }
      }
      if (isObject(value.functionCall))
        inspect(value.functionCall, `${pointer}/functionCall`, keys, found);
      return;
    case 'STRUCTURAL':
      if (
        isObject(value) &&
        typeof value.componentId === 'string' &&
        typeof value.path === 'string'
      ) {
        found.push({kind: 'template', pointer, componentId: value.componentId, path: value.path});
      }
      return;
    case 'CHECKABLE':
      if (!Array.isArray(value)) return;
      value.forEach((rule: unknown, index) => {
        if (isObject(rule)) inspect(rule.condition, `${pointer}/${index}/condition`, keys, found);
      });
      return;
    case 'OBJECT':
      if (!isObject(value)) return;
      for (const [key, item] of Object.entries(value)) {
        const child = node.shape[key];
        if (child !== undefined) walk(item, child, `${pointer}/${token(key)}`, keys, found);
      }
      return;
    case 'ARRAY':
      if (!Array.isArray(value)) return;
      value.forEach((item: unknown, index) =>
        walk(item, node.element, `${pointer}/${index}`, keys, found),
      );
      return;
    case 'STATIC':
      return;
  }
}

/**
 * A value in a dynamic position: a binding, a function call whose arguments
 * are inspected in turn, an array of either, or a literal, which is nothing.
 */
function inspect(value: unknown, pointer: string, keys: DynamicKeys, found: DynamicValue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => inspect(item, `${pointer}/${index}`, keys, found));
    return;
  }
  if (!isObject(value)) return;
  const path = value[keys.path];
  if (typeof path === 'string') {
    found.push({kind: 'binding', pointer, path});
    return;
  }
  const name = value[keys.call];
  if (typeof name !== 'string') return;
  found.push({kind: 'call', pointer, name, call: value});
  if (isObject(value.args)) {
    for (const [key, item] of Object.entries(value.args)) {
      inspect(item, `${pointer}/args/${token(key)}`, keys, found);
    }
  }
}
