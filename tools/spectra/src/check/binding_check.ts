/**
 * The binding check, on each surface the turn touched as it stands at the
 * turn's close: every path the surface's components bind to has a value in
 * the surface's data model. Web core's behaviour tree over the catalog
 * entry's schema says which properties are bindings; web core's data model
 * answers each lookup, a key that is present counting as a value whatever it
 * holds. The walk starts at `root` and follows web core's child references,
 * so a component the root does not reach is the structural check's alone. A
 * template's list path must hold an array, and the template component's
 * bindings are resolved against each item's scope; a binding unfilled in
 * some items is one finding naming how many.
 */
import {DataModel, type SurfaceModel} from '@a2ui/web_core/state';

import type {Finding, SkippedSurface} from '../record/turn_record.js';
import type {CheckResult} from './check_event.js';
import type {Conversation} from './conversation.js';
import {dynamicValues} from './dynamic.js';
import {SkippedList, skippedSurface} from './skipped.js';

export function checkBinding(conversation: Conversation): CheckResult {
  const findings: Finding[] = [];
  const skipped = new SkippedList();
  const skip = (entry: SkippedSurface) => skipped.add(entry);
  for (const surfaceId of conversation.touched) {
    const surface = conversation.surfaces.get(surfaceId);
    const catalogId = conversation.catalogIdOf.get(surfaceId);
    if (surface === undefined) {
      if (!conversation.deletedByTurn.has(surfaceId)) {
        skip(skippedSurface(surfaceId, catalogId, 'not_created'));
      }
      continue;
    }
    if (catalogId === undefined || conversation.resolve(catalogId) === undefined) {
      skip(skippedSurface(surfaceId, catalogId, 'no_definition'));
      continue;
    }
    findings.push(...new SurfaceBindings(conversation, surfaceId, surface, skip).findings());
  }
  return {findings, skipped: skipped.list};
}

/** One binding, as written, and what the walk found at it across the scopes it was resolved in. */
interface Bound {
  componentId: string;
  /** The pointer from the turn object, when this turn's message carried the component. */
  path?: string;
  /** The path as the component writes it. */
  binding: string;
  /** How many scopes it was resolved in: one outside a template, one per item inside. */
  visits: number;
  /** The resolved paths with no value, in order. */
  missing: string[];
}

class SurfaceBindings {
  readonly #conversation: Conversation;
  readonly #surfaceId: string;
  readonly #surface: SurfaceModel;
  readonly #skip: (entry: SkippedSurface) => void;
  readonly #bound = new Map<string, Bound>();
  readonly #findings: Finding[] = [];

  constructor(
    conversation: Conversation,
    surfaceId: string,
    surface: SurfaceModel,
    skip: (entry: SkippedSurface) => void,
  ) {
    this.#conversation = conversation;
    this.#surfaceId = surfaceId;
    this.#surface = surface;
    this.#skip = skip;
  }

  findings(): Finding[] {
    if (this.#surface.componentsModel.has(this.#surface.rootId)) {
      this.#visit(this.#surface.rootId, '', new Set());
    }
    const unfilled: Finding[] = [];
    for (const bound of this.#bound.values()) {
      if (bound.missing.length === 0) continue;
      const first = bound.missing[0];
      const where =
        bound.visits === 1
          ? `The data model has no value at ${first}`
          : `The data model has no value at ${bound.binding} in ${bound.missing.length} of ${bound.visits} items, the first at ${first}`;
      unfilled.push({
        code: 'BINDING_PATH_UNFILLED',
        surfaceId: this.#surfaceId,
        ...(bound.path !== undefined && {path: bound.path}),
        message:
          bound.path !== undefined
            ? `${where}.`
            : `${where}, bound by the component '${bound.componentId}' in the surface '${this.#surfaceId}'.`,
      });
    }
    return [...this.#findings, ...unfilled];
  }

  /** Walks one component in one scope, then its children in the same scope and its templates' children per item. */
  #visit(componentId: string, scope: string, chain: ReadonlySet<string>): void {
    if (chain.has(componentId)) return;
    const model = this.#surface.componentsModel;
    const component = model.get(componentId);
    if (component === undefined) return;
    const carrier = this.#conversation.carrier(this.#surfaceId, componentId);
    const raw = carrier?.component ?? (component.componentTree as Record<string, unknown>);
    const version = carrier?.version ?? this.#surface.protocolVersion;
    const api = component.catalog.components.get(component.type);
    if (api === undefined) {
      if (component.catalog.id !== this.#surface.defaultCatalog?.id) {
        this.#skip({
          surfaceId: this.#surfaceId,
          catalogId: component.catalog.id,
          reason: 'no_definition',
        });
      }
      return;
    }
    const below = new Set([...chain, componentId]);
    for (const value of dynamicValues(raw, api, version)) {
      const pointer = carrier?.own ? carrier.path + value.pointer : undefined;
      if (value.kind === 'binding') {
        this.#resolve(componentId, pointer, value.pointer, value.path, scope);
      } else if (value.kind === 'template') {
        const listPath = DataModel.resolvePath(value.path, scope);
        const list: unknown = this.#surface.dataModel.get(listPath);
        if (list === undefined) {
          this.#resolve(
            componentId,
            pointer && `${pointer}/path`,
            `${value.pointer}/path`,
            value.path,
            scope,
          );
        } else if (!Array.isArray(list)) {
          this.#findings.push({
            code: 'BINDING_LIST_NOT_ARRAY',
            surfaceId: this.#surfaceId,
            ...(pointer !== undefined && {path: `${pointer}/path`}),
            message: `The data model's value at ${listPath} is not a list, so the template '${value.componentId}' draws no items.`,
          });
        } else {
          list.forEach((_, index) => this.#visit(value.componentId, `${listPath}/${index}`, below));
        }
      }
    }
    for (const [childId, propertyPath] of model.getChildReferences(componentId)) {
      if (propertyPath.endsWith('.componentId')) continue;
      if (model.has(childId)) this.#visit(childId, scope, below);
    }
  }

  /** Looks one binding up in one scope and keeps what it found. */
  #resolve(
    componentId: string,
    path: string | undefined,
    inner: string,
    binding: string,
    scope: string,
  ): void {
    const key = `${componentId}\u0000${inner}`;
    let bound = this.#bound.get(key);
    if (bound === undefined) {
      bound = {componentId, ...(path !== undefined && {path}), binding, visits: 0, missing: []};
      this.#bound.set(key, bound);
    }
    bound.visits++;
    const resolved = DataModel.resolvePath(binding, scope);
    if (!this.#surface.dataModel.hasPath(resolved)) bound.missing.push(resolved);
  }
}
