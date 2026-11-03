/** The wrapper while it is switched on: what every hook reads. */

import type {Tracer} from '@opentelemetry/api';

import type {InferenceFormat} from './table.js';

export interface Active {
  /** The tracer the spans go to, read when an event ends. */
  tracer(): Tracer;
  /** The agent SDK's version, as its `package.json` gives it. */
  readonly sdkVersion: string;
  /** The format of a parser of one of the two formats' classes. */
  parserFormat(parser: unknown): InferenceFormat | undefined;
  /** The format of a prompt generator of one of the two formats' classes. */
  generatorFormat(generator: unknown): InferenceFormat | undefined;
}

let active: Active | undefined;

/** The switched-on wrapper, or nothing: every hook then calls straight through. */
export function current(): Active | undefined {
  return active;
}

export function activate(state: Active): void {
  active = state;
}

export function deactivate(): void {
  active = undefined;
}
