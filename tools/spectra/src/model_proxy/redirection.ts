/**
 * Redirection: the base-URL variables `run` sets and `attach` prints, each
 * pointing at its own prefix on the model proxy, and where each prefix's
 * calls forward: what the variable's client would have resolved from the
 * values in Spectra's own environment, else the provider's own API.
 */
import {removeFromUrl} from './credentials.js';

export const DEFAULT_MODEL_PROXY_PORT = 9822;

/** The five variables, in the order they are printed. */
export const VARIABLES = [
  'GOOGLE_GEMINI_BASE_URL',
  'OPENAI_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_BASE',
  'GEMINI_API_BASE',
] as const;

export type Variable = (typeof VARIABLES)[number];

const GEMINI_HOST = 'https://generativelanguage.googleapis.com';
const OPENAI_API = 'https://api.openai.com/v1';
const ANTHROPIC_HOST = 'https://api.anthropic.com';

/** Where a prefix's calls forward. */
export type Target =
  | {kind: 'base'; base: string}
  /**
   * LiteLLM's `gemini/` route without `GEMINI_API_BASE`: the provider's own
   * host, under `v1alpha` for a model whose name contains `gemini-3` and
   * `v1beta` otherwise. LiteLLM 1.81.10, `litellm/llms/vertex_ai/common_utils.py`,
   * `_get_gemini_url`, with `VertexGeminiConfig._is_gemini_3_or_newer` in
   * `litellm/llms/vertex_ai/gemini/vertex_and_google_ai_studio_gemini.py`.
   */
  | {kind: 'litellm_gemini'};

/** One variable as `run` sets it and `attach` prints it. */
export interface Redirection {
  name: Variable;
  /** The value: the variable's prefix on the model proxy, with no trailing slash. */
  value: string;
  target: Target;
}

/** The origins that are the model proxy itself, for an original value that points back at it. */
function isProxyItself(value: string, proxyOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const proxy = new URL(proxyOrigin);
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
  return (
    url.protocol === proxy.protocol &&
    loopback.has(url.hostname) &&
    loopback.has(proxy.hostname) &&
    (url.port || '80') === (proxy.port || '80')
  );
}

/** An original value from Spectra's environment: set, not blank, and not the proxy itself. */
function original(env: NodeJS.ProcessEnv, name: string, proxyOrigin: string): string | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === '' || isProxyItself(value, proxyOrigin)) {
    return undefined;
  }
  return value.replace(/\/+$/, '');
}

/** The five redirections, each forwarding to what its client would have resolved. */
export function redirections(env: NodeJS.ProcessEnv, proxyOrigin: string): Redirection[] {
  const base = (value: string): Target => ({kind: 'base', base: value});
  const anthropicBaseUrl = original(env, 'ANTHROPIC_BASE_URL', proxyOrigin);
  const anthropicApiBase = original(env, 'ANTHROPIC_API_BASE', proxyOrigin);
  const geminiApiBase = original(env, 'GEMINI_API_BASE', proxyOrigin);
  const targets: Record<Variable, Target> = {
    GOOGLE_GEMINI_BASE_URL: base(
      original(env, 'GOOGLE_GEMINI_BASE_URL', proxyOrigin) ?? GEMINI_HOST,
    ),
    OPENAI_BASE_URL: base(
      original(env, 'OPENAI_BASE_URL', proxyOrigin) ??
        original(env, 'OPENAI_API_BASE', proxyOrigin) ??
        OPENAI_API,
    ),
    ANTHROPIC_BASE_URL: base(anthropicBaseUrl ?? ANTHROPIC_HOST),
    // LiteLLM appends `/v1/messages` to the base unless it already ends so (LiteLLM 1.81.10, `litellm/main.py`).
    ANTHROPIC_API_BASE: base(
      (anthropicApiBase ?? anthropicBaseUrl ?? ANTHROPIC_HOST).replace(/\/v1\/messages$/, ''),
    ),
    GEMINI_API_BASE: geminiApiBase === undefined ? {kind: 'litellm_gemini'} : base(geminiApiBase),
  };
  return VARIABLES.map(name => ({name, value: `${proxyOrigin}/${name}`, target: targets[name]}));
}

/** The variables `run` sets in the agent's environment. */
export function environmentOf(list: Redirection[]): Record<string, string> {
  return Object.fromEntries(list.map(({name, value}) => [name, value]));
}

/** Where a target forwards, in words, with credentials removed. */
export function describeTarget(target: Target): string {
  if (target.kind === 'litellm_gemini') {
    return `${GEMINI_HOST}/v1beta, or /v1alpha for a gemini-3 model`;
  }
  const text = removeFromUrl(target.base);
  // A bare origin reads back with a slash the base does not have.
  return text.endsWith('/') && !target.base.endsWith('/') ? text.slice(0, -1) : text;
}

/**
 * The lines `attach` prints: the instruction, one POSIX export per variable,
 * then the tool servers' lines, and the note on values already set.
 */
export function attachLines(
  list: Redirection[],
  toolExports: string[] = [],
): {intro: string; exports: string[]; note: string} {
  return {
    intro: "To see model and tool calls, set these in the agent's shell and restart it:",
    exports: [
      ...list.map(
        ({name, value, target}) =>
          `export ${name}=${value}  # forwards to ${describeTarget(target)}`,
      ),
      ...toolExports,
    ],
    note:
      "If the agent's shell already sets one of the model or tool variables to another address, " +
      'start Spectra with that value set as well, so the proxy forwards there.',
  };
}

/** The variables and values the API serves under `attach`, for the first screen. */
export function variablesOf(list: Redirection[]): Array<{name: string; value: string}> {
  return list.map(({name, value}) => ({name, value}));
}

/** The model as LiteLLM names it in a Gemini path, `models/{model}:{endpoint}`. */
function modelOfPath(pathname: string): string | undefined {
  return /\/models\/([^/:]+)(?::|$)/.exec(pathname)?.[1];
}

/**
 * Where a call under a prefix forwards: the target's base followed by the
 * rest of the call's path and its query.
 */
export function forwardTo(target: Target, rest: string): string {
  if (target.kind === 'base') {
    return target.base + rest;
  }
  const model = modelOfPath(rest.split('?')[0]) ?? '';
  return `${GEMINI_HOST}/${model.includes('gemini-3') ? 'v1alpha' : 'v1beta'}${rest}`;
}

/** The variable a path's first segment names, with the rest of the path, or nothing for another path. */
export function splitPrefix(pathAndQuery: string): {name: Variable; rest: string} | undefined {
  const match = /^\/([A-Z_]+)(\/.*|\?.*)?$/.exec(pathAndQuery);
  if (match === null) {
    return undefined;
  }
  const name = VARIABLES.find(variable => variable === match[1]);
  if (name === undefined) {
    return undefined;
  }
  const rest = match[2] ?? '';
  return {name, rest: rest.startsWith('?') ? `/${rest}` : rest};
}
