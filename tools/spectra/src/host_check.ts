import type {IncomingHttpHeaders, IncomingMessage, ServerResponse} from 'node:http';
import type {Duplex} from 'node:stream';

/** The names the server always answers: the loopback addresses. */
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** The host name in a `Host` header, lowercased, without its port. */
export function hostNameOf(hostHeader: string): string {
  let host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(':');
  if (colon !== -1 && host.indexOf(':') === colon) {
    host = host.slice(0, colon);
  }
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

/**
 * Whether the server answers a request with this `Host` header: a loopback
 * name, or a name given with `--allow-host`. A request without one is refused.
 */
export function isAllowedHost(
  hostHeader: string | undefined,
  allowedHosts: readonly string[],
): boolean {
  if (hostHeader === undefined || hostHeader.trim() === '') {
    return false;
  }
  const name = hostNameOf(hostHeader);
  return LOOPBACK_HOSTS.includes(name) || allowedHosts.includes(name);
}

/** The `403` body for a request whose `Host` is not answered. */
export const HOST_REFUSED =
  'Blocked request: this host is not allowed. To allow it, start Spectra with --allow-host <name>.\n';

/** The `403` body for a page's request to a proxy whose callers are not pages. */
export const PAGE_REFUSED = 'Blocked request: this proxy does not take requests from a web page.\n';

/** The `403` body for a page's request from a name that is not answered. */
export const ORIGIN_NOT_ALLOWED =
  'Blocked request: this origin is not allowed. To allow it, start Spectra with --allow-host <name>.\n';

/**
 * Whether an `Origin` header names an `http` or `https` origin on a loopback
 * name, or on a name given with `--allow-host`. The opaque origin, `null`,
 * is refused.
 */
export function isAllowedOrigin(origin: string, allowedHosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const name = url.hostname.toLowerCase();
  return LOOPBACK_HOSTS.includes(name) || allowedHosts.includes(name);
}

/**
 * Why a proxy refuses a request or an upgrade, as its `403` body, or nothing
 * when it takes it. A `Host` that is not answered is refused first. Then a
 * request carrying `Origin`, a page's: on a proxy whose callers are the
 * agent's clients, `pages` `refused`, any; on the wire proxy, whose callers
 * include a host app in a browser, `pages` `allowed hosts`, one whose origin
 * is not on a loopback name or one allowed.
 */
export function proxyRefusal(
  headers: IncomingHttpHeaders,
  allowedHosts: readonly string[],
  pages: 'refused' | 'allowed hosts',
): string | undefined {
  if (!isAllowedHost(headers.host, allowedHosts)) return HOST_REFUSED;
  const origin = headers.origin;
  if (origin === undefined) return undefined;
  if (pages === 'refused') return PAGE_REFUSED;
  return isAllowedOrigin(origin, allowedHosts) ? undefined : ORIGIN_NOT_ALLOWED;
}

/** Answers a request the proxy refuses `403` with the refusal as plain text, and reads no more of it. */
export function refuseRequest(
  request: IncomingMessage,
  response: ServerResponse,
  refusal: string,
): void {
  request.resume();
  response.writeHead(403, {'content-type': 'text/plain; charset=utf-8'});
  response.end(refusal);
}

/** Answers an upgrade the proxy refuses `403` with the refusal as plain text, and closes the socket. */
export function refuseUpgrade(socket: Duplex, refusal: string): void {
  socket.end(
    `HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n${refusal}`,
  );
}
