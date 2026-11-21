/**
 * The turn record versions this release reads, and the line that says a
 * record or a span of the A2UI step follows a newer one. A release reads the
 * versions it knows and refuses every other, a version that differs in its
 * third part alone included. A version of the record's form newer than every
 * one it knows is newer, and the line names it, the versions this Spectra
 * reads and Spectra as the side to upgrade. A version that is missing or not
 * of the record's form is not called newer.
 */
import {NAME} from '../version.js';
import type {TurnRecordVersion} from './turn_record.js';

/** The versions this release reads, oldest first. */
export const READ_VERSIONS: readonly string[] = ['v0.1'];

/** The version this release writes. */
export const WRITTEN_VERSION: TurnRecordVersion = 'v0.1';

/** A version in the record's form: `v<major>.<minor>`, with an optional third part. */
const FORM = /^v([0-9]+)\.([0-9]+)(?:\.([0-9]+))?$/;

/** How a stated version reads to this release. */
export type VersionReading =
  | {kind: 'read'; version: string}
  | {kind: 'newer'; version: string}
  /** Of the record's form, not one this release reads, and not newer than every one it does. */
  | {kind: 'unknown'; version: string}
  /** Missing, or not of the record's form. */
  | {kind: 'not_a_version'};

/** A version's three parts, a missing third read as 0; nothing when it is not of the record's form. */
function partsOf(version: string): [number, number, number] | undefined {
  const match = FORM.exec(version);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? '0')];
}

function isAfter(a: readonly number[], b: readonly number[]): boolean {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

/** How a record's `version`, or a span's `a2ui.record.version`, reads to this release. */
export function readVersion(value: unknown): VersionReading {
  if (typeof value !== 'string') return {kind: 'not_a_version'};
  const parts = partsOf(value);
  if (parts === undefined) return {kind: 'not_a_version'};
  if (READ_VERSIONS.includes(value)) return {kind: 'read', version: value};
  const newest = READ_VERSIONS.map(known => partsOf(known)!).reduce((latest, known) =>
    isAfter(known, latest) ? known : latest,
  );
  return isAfter(parts, newest)
    ? {kind: 'newer', version: value}
    : {kind: 'unknown', version: value};
}

/** The versions this release reads, as a line names them: `v0.1`, or `v0.1 and v0.2`. */
export function readVersionsText(): string {
  return READ_VERSIONS.length === 1
    ? READ_VERSIONS[0]
    : `${READ_VERSIONS.slice(0, -1).join(', ')} and ${READ_VERSIONS.at(-1)}`;
}

/**
 * The newer line, after what was met: "turn record v0.2, newer than this
 * Spectra reads: it reads v0.1. Upgrade a2ui-spectra to read it."
 */
export function newerText(version: string): string {
  return `turn record ${version}, newer than this Spectra reads: it reads ${readVersionsText()}. Upgrade ${NAME} to read it.`;
}
