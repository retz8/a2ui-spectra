/** What the wrapper instruments: the agent SDK, at the release it was written against. */

import {createRequire} from 'node:module';

/** The instrumentation scope's name. */
export const SCOPE_NAME = 'a2ui-spectra-instrumentation';

/** The wrapper's own version, the instrumentation scope's version. */
export const VERSION: string = (
  createRequire(import.meta.url)('../package.json') as {version: string}
).version;

/** The agent SDK, by its package name. */
export const AGENT_SDK = '@a2ui/agent';

/** The version floor: the agent SDK's release the hooked names are first public in. */
export const FLOOR = '0.1.0';

/** The release the hooked names were read from. */
export const PIN = "@a2ui/agent 0.1.0, upstream's release of 2026-11-02";
