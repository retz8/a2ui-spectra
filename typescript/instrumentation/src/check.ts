/**
 * The pinned-API check: `@a2ui/agent` resolves, its version is at least the
 * floor, and every name of the hook table is a function on its class's
 * prototype. They stand or fall together; a refusal is one warning line naming
 * the package and the version found, the first missing name, and the release
 * the wrapper was written against.
 */

import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as path from 'node:path';

import {logger, messageOf, warn} from './log.js';
import {AGENT_SDK, FLOOR, PIN} from './package.js';
import {FORMAT_CLASSES, HOOKS, type Hook, type InferenceFormat} from './table.js';

const require = createRequire(import.meta.url);

/** A hooked name, resolved: the prototype that holds it. */
interface Target {
  readonly hook: Hook;
  readonly prototype: object;
}

/** What the check found: the SDK's version, every name to hook, and the formats' classes. */
export interface Plan {
  readonly sdkVersion: string;
  readonly targets: readonly Target[];
  readonly parsers: ReadonlyArray<readonly [Function, InferenceFormat]>;
  readonly generators: ReadonlyArray<readonly [Function, InferenceFormat]>;
}

/**
 * The SDK's version: what the first `package.json` with a name above its entry
 * file gives, when that name is the SDK's. That one is the package's own; the
 * walk reads no manifest above it, the agent's and its ancestors' among them.
 */
function sdkVersion(entry: string): string | undefined {
  let dir = path.dirname(entry);
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      const json = JSON.parse(readFileSync(file, 'utf8')) as {name?: unknown; version?: unknown};
      if (typeof json.name === 'string') {
        return json.name === AGENT_SDK && typeof json.version === 'string'
          ? json.version
          : undefined;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** A version's release numbers and prerelease, or nothing when it is not one. */
function parseVersion(version: string): [number, number, number, string | undefined] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
}

/** Whether a version is at least the floor; a prerelease of the floor is below it. */
export function atLeast(version: string, floor: string): boolean {
  const found = parseVersion(version);
  const wanted = parseVersion(floor);
  if (found === undefined || wanted === undefined) return false;
  for (let i = 0; i < 3; i++) {
    if (found[i] !== wanted[i]) return (found[i] as number) > (wanted[i] as number);
  }
  return found[3] === undefined || wanted[3] !== undefined;
}

/** The one line a refusal writes: nothing of the SDK is hooked, and why. */
export function refuse(version: string | undefined, why: string): void {
  warn(
    `a2ui-spectra-instrumentation left ${AGENT_SDK} ${version ?? '(not installed)'} unpatched: ` +
      `${why}; it was written against ${PIN} (${AGENT_SDK} >= ${FLOOR})`,
  );
}

/** The names to hook, or nothing when the SDK is refused. */
export function check(): Plan | undefined {
  let entry: string;
  try {
    entry = require.resolve(AGENT_SDK);
  } catch {
    refuse(undefined, 'it is not installed');
    return undefined;
  }
  const version = sdkVersion(entry);
  if (version === undefined) {
    refuse(undefined, `no package.json names it above ${entry}`);
    return undefined;
  }
  if (!atLeast(version, FLOOR)) {
    refuse(version, 'it is below the version floor');
    return undefined;
  }
  let sdk: Record<string, unknown>;
  try {
    sdk = require(AGENT_SDK) as Record<string, unknown>;
  } catch (error) {
    refuse(version, `it could not be loaded (${messageOf(error)})`);
    return undefined;
  }
  const classOf = (name: string): Function | undefined =>
    typeof sdk[name] === 'function' ? (sdk[name] as Function) : undefined;
  const targets: Target[] = [];
  for (const hook of HOOKS) {
    const prototype = classOf(hook.className)?.prototype as Record<string, unknown> | undefined;
    if (typeof prototype?.[hook.method] !== 'function') {
      refuse(version, `${hook.className}.${hook.method} is missing`);
      return undefined;
    }
    targets.push({hook, prototype});
  }
  const formats = Object.entries(FORMAT_CLASSES) as Array<
    [InferenceFormat, (typeof FORMAT_CLASSES)[InferenceFormat]]
  >;
  logger.debug(`${AGENT_SDK} ${version} passes the check`);
  return {
    sdkVersion: version,
    targets,
    parsers: formats.map(([format, classes]) => [classOf(classes.parser) as Function, format]),
    generators: formats.map(([format, classes]) => [
      classOf(classes.generator) as Function,
      format,
    ]),
  };
}
