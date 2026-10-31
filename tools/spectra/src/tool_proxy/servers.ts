/**
 * The tool servers the config names, each reached through its own listener
 * on the tool proxy: the variable the agent reads the server's URL from, the
 * value `run` sets and `attach` prints, and the original the listener
 * forwards to.
 */
import type {ToolServerConfig} from '../config.js';
import {removeFromUrl} from '../model_proxy/credentials.js';
import {LOOPBACK_ADDRESS} from '../server.js';

/** One tool server as Spectra reaches it. */
export interface ToolServer {
  variable: string;
  /** The tool proxy's port for this server, on loopback. */
  port: number;
  /** The listener's origin, standing for the original's. */
  proxyOrigin: string;
  /** The value: the listener's origin followed by the original's path and query. */
  value: string;
  /** The original URL: the environment's value of the variable, else the config's URL. */
  original: URL;
}

/** An environment value for a tool variable that is not a URL Spectra can forward to. */
export class ToolServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolServerError';
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether a value points at one of the tool proxy's own listeners, left over from an earlier `attach`. */
function isToolProxyItself(url: URL, ports: number[]): boolean {
  return (
    url.protocol === 'http:' && LOOPBACK.has(url.hostname) && ports.includes(Number(url.port || 80))
  );
}

/**
 * The tool servers, in config order, each on its port. When Spectra's own
 * environment sets a server's variable to a value that is not blank and not
 * the tool proxy itself, that value is the original instead of the config's
 * URL, as the model proxy takes a base-URL variable already set.
 */
export function toolServers(
  configured: ToolServerConfig[],
  ports: number[],
  env: NodeJS.ProcessEnv,
): ToolServer[] {
  return configured.map(({variable, url}, index) => {
    const port = ports[index];
    const proxyOrigin = `http://${LOOPBACK_ADDRESS}:${port}`;
    let original = url;
    const set = env[variable]?.trim();
    if (set !== undefined && set !== '') {
      let fromEnv: URL;
      try {
        fromEnv = new URL(set);
      } catch {
        throw new ToolServerError(
          `Spectra's environment sets ${variable} to '${set}', which is not a URL. Unset it, or set it to the tool server's URL.`,
        );
      }
      if (fromEnv.protocol !== 'http:' && fromEnv.protocol !== 'https:') {
        throw new ToolServerError(
          `Spectra's environment sets ${variable} to '${set}'; a tool server's URL must start with http:// or https://.`,
        );
      }
      if (!isToolProxyItself(fromEnv, ports)) {
        original = fromEnv;
      }
    }
    return {
      variable,
      port,
      proxyOrigin,
      value: `${proxyOrigin}${original.pathname}${original.search}`,
      original,
    };
  });
}

/** The variables `run` sets in the agent's environment. */
export function toolEnvironmentOf(servers: ToolServer[]): Record<string, string> {
  return Object.fromEntries(servers.map(({variable, value}) => [variable, value]));
}

/** Where a server's listener forwards, in words, with credentials removed. */
export function describeOriginal(server: ToolServer): string {
  return removeFromUrl(server.original.href);
}

/** The line Spectra prints at start for each server, with the port it listens on and where it forwards. */
export function startLines(servers: ToolServer[]): string[] {
  return servers.map(
    server =>
      `The tool proxy for ${server.variable} is at ${server.proxyOrigin}, forwarding to ${server.original.origin}`,
  );
}

/** The POSIX `export` lines `attach` prints after the model proxy's, in config order. */
export function exportLines(servers: ToolServer[]): string[] {
  return servers.map(
    server =>
      `export ${server.variable}=${server.value}  # forwards to ${describeOriginal(server)}`,
  );
}

/** The variables and values the API serves under `attach`, after the model proxy's. */
export function toolVariablesOf(servers: ToolServer[]): Array<{name: string; value: string}> {
  return servers.map(({variable, value}) => ({name: variable, value}));
}
