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
