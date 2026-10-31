/**
 * Credentials removed from what the proxies record: the value of a header or
 * URL parameter that carries one becomes `REMOVED`, its name kept. Removal
 * runs at capture, before the live stream, the API or the store sees an
 * event. What the proxies forward is untouched.
 */

/** The value a removed credential is written as. */
export const REMOVED = 'REMOVED';

const REQUEST_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'cookie',
]);

const RESPONSE_HEADERS = new Set(['set-cookie']);

const URL_PARAMETERS = new Set(['key', 'api_key', 'access_token']);

/** A request header or URL parameter whose name contains one of these carries a credential. */
const NAME_PATTERN = /key|token|secret|auth|password|cookie/i;

/** Whether a request header, by its name, carries a credential. */
export function isCredentialRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return REQUEST_HEADERS.has(lower) || NAME_PATTERN.test(lower);
}

/** Whether a response header, by its name, carries a credential. The name pattern does not apply. */
export function isCredentialResponseHeader(name: string): boolean {
  return RESPONSE_HEADERS.has(name.toLowerCase());
}

/** Whether a URL parameter, by its name, carries a credential. */
export function isCredentialParameter(name: string): boolean {
  return URL_PARAMETERS.has(name.toLowerCase()) || NAME_PATTERN.test(name);
}

/** The headers with each credential's value replaced, names lowercased. */
export function removeFromHeaders(
  headers: Record<string, string[]>,
  side: 'request' | 'response',
): Record<string, string[]> {
  const isCredential = side === 'request' ? isCredentialRequestHeader : isCredentialResponseHeader;
  return Object.fromEntries(
    Object.entries(headers).map(([name, values]) => [
      name.toLowerCase(),
      isCredential(name) ? values.map(() => REMOVED) : values,
    ]),
  );
}

/**
 * The URL with its credentials removed: a `user:pass@` becomes `REMOVED@`,
 * and each parameter that carries a credential keeps its name with the value
 * `REMOVED`. A string that is not a URL is returned as it is.
 */
export function removeFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const userinfo = parsed.username !== '' || parsed.password !== '';
  const origin = `${parsed.protocol}//${userinfo ? `${REMOVED}@` : ''}${parsed.host}`;
  let search = '';
  if (parsed.search !== '') {
    const parameters = parsed.search
      .slice(1)
      .split('&')
      .map(pair => {
        const equals = pair.indexOf('=');
        const name = equals === -1 ? pair : pair.slice(0, equals);
        if (!isCredentialParameter(decodeName(name))) {
          return pair;
        }
        return `${name}=${REMOVED}`;
      });
    search = `?${parameters.join('&')}`;
  }
  return `${origin}${parsed.pathname}${search}${parsed.hash}`;
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name.replaceAll('+', ' '));
  } catch {
    return name;
  }
}
