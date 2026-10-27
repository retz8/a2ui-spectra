/**
 * The structural check, on each surface the turn touched as it stands at the
 * turn's close in web core's state: a walk from `root` over web core's child
 * references finds a child id with no component, a component the walk never
 * reaches, and a surface with no `root`. What web core refused to let into
 * the state, a cycle or self-reference, a duplicate component id in one
 * message and a broken composition rule, is a finding on the message web
 * core threw on, in web core's own words. A surface the turn names that no
 * `createSurface` of the conversation created is a finding on the first
 * message of the turn naming it. A surface whose catalog has no definition is
 * skipped, as the Phase 4 spec has it: without the catalog's reference map
 * there are no child references to walk.
 */
import type {Finding} from '../record/turn_record.js';
import type {CheckResult} from './check_event.js';
import type {Conversation, Rejection} from './conversation.js';
import {propertyPathPointer} from './pointers.js';
import {SkippedList, skippedSurface} from './skipped.js';

export function checkStructural(conversation: Conversation): CheckResult {
  const findings: Finding[] = [];
  const skipped = new SkippedList();
  for (const surfaceId of conversation.touched) {
    const surface = conversation.surfaces.get(surfaceId);
    if (surface === undefined) {
      if (conversation.deletedByTurn.has(surfaceId)) continue;
      if (!conversation.created.has(surfaceId)) {
        const first = conversation.own.find(message => message.surfaceId === surfaceId);
        if (first !== undefined) {
          findings.push({
            code: 'SURFACE_NOT_CREATED',
            surfaceId,
            path: first.type === undefined ? first.path : `${first.path}/${first.type}`,
            message: `No createSurface in the conversation created the surface '${surfaceId}'.`,
          });
        }
      } else {
        skipped.add(
          skippedSurface(surfaceId, conversation.catalogIdOf.get(surfaceId), 'not_created'),
        );
      }
      continue;
    }
    const catalogId = conversation.catalogIdOf.get(surfaceId);
    if (catalogId === undefined || conversation.resolve(catalogId) === undefined) {
      skipped.add(skippedSurface(surfaceId, catalogId, 'no_definition'));
      continue;
    }
    const model = surface.componentsModel;
    const rootId = surface.rootId;
    if (!model.has(rootId)) {
      // A batch web core refused left the surface as it was, perhaps empty.
      const refused = conversation.own.some(
        message =>
          message.surfaceId === surfaceId &&
          message.type === 'updateComponents' &&
          message.rejection !== undefined,
      );
      findings.push({
        code: 'ROOT_MISSING',
        surfaceId,
        message: refused
          ? `The surface '${surfaceId}' has no component with the id '${rootId}': web core refused the updateComponents that carried one.`
          : `The surface '${surfaceId}' has no component with the id '${rootId}'.`,
      });
    }
    const visited = new Set<string>();
    const pending = model.has(rootId) ? [rootId] : [];
    while (pending.length > 0) {
      const id = pending.pop() as string;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const [childId, propertyPath] of model.getChildReferences(id)) {
        if (model.has(childId)) {
          if (!visited.has(childId)) pending.push(childId);
          continue;
        }
        const carrier = conversation.carrier(surfaceId, id);
        findings.push({
          code: 'CHILD_NOT_FOUND',
          surfaceId,
          ...(carrier?.own && {path: carrier.path + propertyPathPointer(propertyPath)}),
          message: `The component '${id}' names a child '${childId}' that no component in the surface '${surfaceId}' defines.`,
        });
      }
    }
    for (const id of model.keys) {
      if (visited.has(id)) continue;
      const carrier = conversation.carrier(surfaceId, id);
      findings.push({
        code: 'COMPONENT_UNREACHABLE',
        surfaceId,
        ...(carrier?.own && {path: carrier.path}),
        message: `The component '${id}' in the surface '${surfaceId}' is not reachable from '${rootId}'.`,
      });
    }
  }
  for (const {type, surfaceId, path, rejection} of conversation.own) {
    if (rejection === undefined || type !== 'updateComponents') continue;
    const code = structuralCode(rejection);
    if (code === undefined) continue;
    findings.push({
      code,
      ...(surfaceId !== undefined && {surfaceId}),
      path: `${path}/${type}`,
      message: rejection.message,
    });
  }
  return {findings, skipped: skipped.list};
}

/** The structural code of what web core threw, when it threw for the surface's structure. */
function structuralCode(rejection: Rejection): string | undefined {
  if (rejection.code === 'UNALLOWED_PARENT' || rejection.code === 'UNALLOWED_CHILD') {
    return rejection.code;
  }
  if (rejection.code === 'RECURSION_ERROR' && /circular reference/i.test(rejection.message)) {
    return 'CYCLIC_REFERENCE';
  }
  if (rejection.code === 'INTEGRITY_ERROR' && /^Duplicate component ID/.test(rejection.message)) {
    return 'DUPLICATE_COMPONENT_ID';
  }
  return undefined;
}
