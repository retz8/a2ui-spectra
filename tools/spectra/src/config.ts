/**
 * The config file: `a2ui-spectra.json` in the directory Spectra is launched
 * from, or the file `--config` names, with the agent's URL and headers, the
 * catalog paths, the preview pages and the tool servers. The file is validated against
 * `config.schema.json`, the schema the running tool serves for editors, and
 * is read strictly: a file that does not parse, a setting of the wrong type
 * or a key Spectra does not know stops Spectra at start. Only the default
 * file being absent is quiet.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {Ajv2020, type ErrorObject} from 'ajv/dist/2020.js';

import schema from './config.schema.json' with {type: 'json'};
import {VARIABLES as MODEL_VARIABLES} from './model_proxy/redirection.js';

/** The config file's name, looked for in the directory Spectra is launched from. */
export const CONFIG_FILE = 'a2ui-spectra.json';

/** The schema the config file is validated against, as the API serves it. */
export const CONFIG_SCHEMA: Readonly<Record<string, unknown>> = schema;

/** A config file Spectra cannot start with. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** The config, read and resolved; the defaults when there is no file. */
export interface SpectraConfig {
  /** The file read, when one was. */
  file?: string;
  /** The agent's base address, when the file names one. */
  agentUrl?: URL;
  /** The headers as written, with their `${VAR}` placeholders. */
  headers: Record<string, string>;
  /** The catalog definition files, as absolute paths. */
  catalogs: string[];
  /** The preview pages' URLs. */
  preview: string[];
  /** The tool servers, in config order. */
  tools: ToolServerConfig[];
  /** The prices that replace the price table's, by model id as requested. */
  prices: Record<string, PriceOverride>;
}

/** A model's price from the config file, in USD per million tokens. */
export interface PriceOverride {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** One tool server: the variable the agent reads its URL from, and the URL as the file gives it. */
export interface ToolServerConfig {
  variable: string;
  url: URL;
}

export interface LoadOptions {
  /** The directory Spectra was launched from. */
  cwd: string;
  /** The file `--config` names, relative to `cwd` when relative; else the default file in `cwd`. */
  path?: string;
}

interface ConfigShape {
  $schema?: string;
  agent?: {url?: string; headers?: Record<string, string>};
  catalogs?: string[];
  preview?: string[];
  tools?: Array<{variable: string; url: string}>;
  prices?: Record<string, PriceOverride>;
}

const validate = new Ajv2020({allErrors: false}).compile<ConfigShape>(schema);

/** Reads the config file, or the defaults when the default file is absent. */
export async function loadConfig({cwd, path: given}: LoadOptions): Promise<SpectraConfig> {
  const file = given === undefined ? path.join(cwd, CONFIG_FILE) : path.resolve(cwd, given);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (given === undefined) {
        return {headers: {}, catalogs: [], preview: [], tools: [], prices: {}};
      }
      throw new ConfigError(`The config file ${file} does not exist.`);
    }
    throw new ConfigError(`${file} cannot be read: ${describe(error)}.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${describe(error)}.`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ConfigError(`${file} must hold a JSON object.`);
  }
  if (!validate(json)) {
    throw new ConfigError(`${file}: ${sentence(validate.errors?.[0])}.`);
  }
  const dir = path.dirname(file);
  const agentUrl =
    json.agent?.url === undefined ? undefined : parseUrl(json.agent.url, 'agent.url', file);
  for (const [index, page] of (json.preview ?? []).entries()) {
    parseUrl(page, `preview[${index}]`, file);
  }
  return {
    file,
    ...(agentUrl !== undefined && {agentUrl}),
    headers: {...(json.agent?.headers ?? {})},
    catalogs: (json.catalogs ?? []).map(entry => path.resolve(dir, entry)),
    preview: [...(json.preview ?? [])],
    tools: readTools(json.tools ?? [], file),
    prices: {...(json.prices ?? {})},
  };
}

/** A POSIX environment variable name. */
const POSIX_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The tool servers: each variable a POSIX name, used once and none of the
 * model proxy's five, each URL starting with `http://` or `https://`.
 */
function readTools(
  entries: ReadonlyArray<{variable: string; url: string}>,
  file: string,
): ToolServerConfig[] {
  const seen = new Set<string>();
  return entries.map(({variable, url}, index) => {
    if (!POSIX_NAME.test(variable)) {
      throw new ConfigError(
        `${file}: tools[${index}].variable must be a variable name of letters, digits and underscores, ` +
          `not starting with a digit, not '${variable}'.`,
      );
    }
    if ((MODEL_VARIABLES as readonly string[]).includes(variable)) {
      throw new ConfigError(
        `${file}: tools[${index}].variable is ${variable}, one of the model proxy's variables; ` +
          'a tool server needs a variable of its own.',
      );
    }
    if (seen.has(variable)) {
      throw new ConfigError(
        `${file}: tools[${index}].variable ${variable} names another tool server already; each needs its own.`,
      );
    }
    seen.add(variable);
    return {variable, url: parseUrl(url, `tools[${index}].url`, file)};
  });
}

/** The variables of the bare `${VAR}` form, with a name of letters, digits and underscores. */
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The headers with each `${VAR}` replaced from the environment. A header
 * naming a variable that is not set is left out, and the variable is named
 * in `unset`, once, in the order met.
 */
export function substituteVariables(
  headers: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
): {headers: Record<string, string>; unset: string[]} {
  const resolved: Record<string, string> = {};
  const unset: string[] = [];
  for (const [name, written] of Object.entries(headers)) {
    let complete = true;
    const value = written.replace(VARIABLE, (placeholder, variable: string) => {
      const found = env[variable];
      if (found === undefined) {
        complete = false;
        if (!unset.includes(variable)) unset.push(variable);
        return placeholder;
      }
      return found;
    });
    if (complete) resolved[name] = value;
  }
  return {headers: resolved, unset};
}

function parseUrl(value: string, setting: string, file: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${file}: ${setting} is not a URL: '${value}'.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(
      `${file}: ${setting} must start with http:// or https://, not '${url.protocol}//'.`,
    );
  }
  return url;
}

/** One validation error as a sentence naming the setting. */
function sentence(error: ErrorObject | undefined): string {
  if (error === undefined) return 'is not a config Spectra can read';
  const setting = settingName(error.instancePath);
  if (error.keyword === 'additionalProperties') {
    const key = (error.params as {additionalProperty: string}).additionalProperty;
    const known = settingsUnder(error.instancePath);
    const name = setting === '' ? `'${key}'` : `'${setting}.${key}'`;
    return setting === ''
      ? `${name} is not a setting; the settings are ${list(known)}`
      : `${name} is not a setting; ${setting} takes ${list(known)}`;
  }
  if (error.keyword === 'type') {
    const type = (error.params as {type: string}).type;
    return `${setting} must be ${type === 'array' || type === 'object' ? 'an' : 'a'} ${type}`;
  }
  return `${setting || 'the file'} ${error.message ?? 'is not valid'}`;
}

/** A JSON Pointer as the setting it names: `/agent/url` as `agent.url`, `/catalogs/0` as `catalogs[0]`. */
function settingName(pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((segment, index) =>
      /^\d+$/.test(segment) ? `[${segment}]` : index === 0 ? segment : `.${segment}`,
    )
    .join('');
}

/** The settings the schema defines under an object, other than `$schema`. */
function settingsUnder(pointer: string): string[] {
  type Node = {
    properties?: Record<string, unknown>;
    items?: unknown;
    additionalProperties?: unknown;
  };
  let node: Node = schema;
  for (const segment of pointer.split('/').slice(1)) {
    const named = /^\d+$/.test(segment) ? node.items : node.properties?.[segment];
    // A key of an object keyed by name, such as a model id under `prices`.
    const keyed = typeof node.additionalProperties === 'object' ? node.additionalProperties : {};
    node = (named ?? keyed) as Node;
  }
  return Object.keys(node.properties ?? {}).filter(key => key !== '$schema');
}

function list(items: string[]): string {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
