/** The check event a check's result becomes, under the turn event. */
import type {
  CheckEvent,
  CheckName,
  Finding,
  ProtocolVersion,
  SkippedSurface,
  TurnEvent,
} from '../record/turn_record.js';
import {comparePointers} from './pointers.js';

/** What one check found in a turn. */
export interface CheckResult {
  findings: Finding[];
  /** The surfaces the check could not judge; the schema check has none. */
  skipped?: SkippedSurface[];
}

/** The findings ordered by the message and the component they point at, those with no path last. */
export function orderFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => comparePointers(a.path, b.path));
}

/**
 * The check event for a result, with the span id and time given. The check
 * passed when it found nothing; the skipped list is written for every check
 * but the schema check, empty when nothing was skipped.
 */
export function checkEvent(
  turnEvent: TurnEvent,
  name: CheckName,
  protocolVersion: ProtocolVersion,
  result: CheckResult,
  {spanId, timeUnixNano}: {spanId: string; timeUnixNano: bigint},
): CheckEvent {
  const findings = orderFindings(result.findings);
  return {
    traceId: turnEvent.traceId,
    spanId,
    parentSpanId: turnEvent.spanId,
    name: 'check',
    kind: 1,
    startTimeUnixNano: timeUnixNano.toString(),
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': name,
      'a2ui.check.passed': findings.length === 0,
      'a2ui.check.protocol_version': protocolVersion,
      'a2ui.check.findings': findings,
      ...(name !== 'schema' && {'a2ui.check.skipped': result.skipped ?? []}),
    },
  };
}
