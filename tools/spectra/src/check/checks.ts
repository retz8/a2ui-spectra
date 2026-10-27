/**
 * The four checks run on a closed turn, and the check events they become:
 * the schema check, then the catalog, structural and binding checks on the
 * conversation fed through web core. Every turn with a known protocol version
 * gets all four events; a turn with no version from anywhere gets none.
 */
import type {CatalogRegistry} from '../catalog/registry.js';
import type {CheckEvent, ProtocolVersion, Turn, TurnEvent} from '../record/turn_record.js';
import {checkBinding} from './binding_check.js';
import {checkCatalog} from './catalog_check.js';
import {type CheckResult, checkEvent} from './check_event.js';
import {feedConversation} from './conversation.js';
import {checkSchema} from './schema_check.js';
import {checkStructural} from './structural_check.js';

export interface TurnChecks {
  protocolVersion: ProtocolVersion;
  schema: CheckResult;
  catalog: CheckResult;
  structural: CheckResult;
  binding: CheckResult;
}

/** Runs the four checks; nothing when the turn has no protocol version. */
export function checkTurn(
  turn: Turn,
  earlierTurns: readonly Turn[] = [],
  registry?: CatalogRegistry,
): TurnChecks | undefined {
  const schema = checkSchema(turn);
  if (schema === undefined) return undefined;
  const conversation = feedConversation(turn, earlierTurns, registry);
  try {
    return {
      protocolVersion: schema.protocolVersion,
      schema: {findings: schema.findings},
      catalog: checkCatalog(conversation),
      structural: checkStructural(conversation),
      binding: checkBinding(conversation),
    };
  } finally {
    conversation.dispose();
  }
}

/** The four check events, in the checks' order, each given its ids by the caller. */
export function checkEvents(
  turnEvent: TurnEvent,
  checks: TurnChecks,
  ids: () => {spanId: string; timeUnixNano: bigint},
): CheckEvent[] {
  return (['schema', 'catalog', 'structural', 'binding'] as const).map(name =>
    checkEvent(turnEvent, name, checks.protocolVersion, checks[name], ids()),
  );
}
