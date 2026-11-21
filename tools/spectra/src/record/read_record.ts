/**
 * Reading a turn record file: one function for every place a record file is
 * read, the `replay` command, the `test` command, the fixtures folder and the
 * local store. A record of a version this release does not read is refused,
 * one of a newer version with the newer line.
 */
import {isEventOfKind, type TurnRecord} from './turn_record.js';
import {newerText, readVersion, readVersionsText} from './versions.js';

/** A file that does not read as a turn record. */
export class RecordReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordReadError';
  }
}

/** A turn record of a version newer than this release reads. */
export class NewerRecordError extends RecordReadError {
  constructor(readonly version: string) {
    super(`The file is a ${newerText(version)}`);
    this.name = 'NewerRecordError';
  }
}

/** Reads a file's text as a turn record of a version this release reads, or throws with the reason. */
export function readRecord(text: string): TurnRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new RecordReadError(
      `The file is not JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  return recordOf(json);
}

/** A parsed value as a turn record of a version this release reads, or throws with the reason. */
export function recordOf(json: unknown): TurnRecord {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw notARecord('it is not an object');
  }
  const record = json as Record<string, unknown>;
  const version = readVersion(record.version);
  if (version.kind === 'newer') throw new NewerRecordError(version.version);
  if (version.kind !== 'read') {
    throw notARecord(
      `its version is ${typeof record.version === 'string' ? record.version : 'missing'}`,
    );
  }
  if (!Array.isArray(record.turns) || record.turns.length === 0) {
    throw notARecord('it has no turns');
  }
  for (const [index, turn] of record.turns.entries()) {
    const events = (turn as {events?: unknown})?.events;
    if (!Array.isArray(events)) throw notARecord(`turn ${index + 1} has no events`);
    if (!events.some(event => isTurnEvent(event))) {
      throw notARecord(`turn ${index + 1} has no turn event`);
    }
  }
  return json as TurnRecord;
}

function notARecord(reason: string): RecordReadError {
  return new RecordReadError(`The file is not a turn record ${readVersionsText()}: ${reason}.`);
}

function isTurnEvent(event: unknown): boolean {
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as {attributes?: unknown}).attributes === 'object' &&
    isEventOfKind(event as TurnRecord['turns'][number]['events'][number], 'turn')
  );
}
