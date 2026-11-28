/**
 * Credentials removed from what the receiver takes, by the rules the proxies
 * remove them from an exchange by: a span, a span event or a log record
 * reaches the record with a URL's credentials and a credential header's
 * value written as `REMOVED`. A framework's HTTP instrumentation puts the
 * request's URL, and its headers when asked to, on its spans, so the key a
 * proxy removed from its own event would stay on the span of the same call.
 * An attribute's value is read by its name and its own form alone: a text
 * that holds a URL inside it, and a log's body, are kept as sent.
 */
import {REMOVED, removeFromHeaders, removeFromUrl} from '../proxying/credentials.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';

const HEADER = /^http\.(request|response)\.header\.(.+)$/;

/** The attributes that hold a URL's query, or its path and query, with no host. */
const QUERIES = new Set(['url.query']);
const TARGETS = new Set(['http.target']);

const ANY_ORIGIN = 'http://removed.invalid';

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function withoutCredentials(name: string, value: unknown): unknown {
  const header = HEADER.exec(name);
  if (header !== null) {
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    const [removed] = Object.values(
      removeFromHeaders({[header[2]]: values}, header[1] as 'request' | 'response'),
    );
    if (!removed.includes(REMOVED)) return value;
    return Array.isArray(value) ? removed : REMOVED;
  }
  if (Array.isArray(value)) {
    return value.map(item =>
      typeof item === 'string' && isUrl(item) ? removeFromUrl(item) : item,
    );
  }
  if (typeof value !== 'string') return value;
  if (isUrl(value)) return removeFromUrl(value);
  if (QUERIES.has(name)) {
    return removeFromUrl(`${ANY_ORIGIN}/?${value}`).slice(`${ANY_ORIGIN}/?`.length);
  }
  if (TARGETS.has(name) && value.startsWith('/')) {
    return removeFromUrl(`${ANY_ORIGIN}${value}`).slice(ANY_ORIGIN.length);
  }
  return value;
}

/** The attributes with each credential removed. */
export function attributesWithoutCredentials(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [name, withoutCredentials(name, value)]),
  );
}

/** A received span with the credentials removed from its attributes and its events'. */
export function spanWithoutCredentials(span: ReceivedSpan): ReceivedSpan {
  return {
    ...span,
    attributes: attributesWithoutCredentials(span.attributes),
    events: span.events.map(event =>
      event.attributes === undefined
        ? event
        : {...event, attributes: attributesWithoutCredentials(event.attributes)},
    ),
  };
}

/** A received log record with the credentials removed from its attributes. */
export function logWithoutCredentials(log: ReceivedLog): ReceivedLog {
  return {...log, attributes: attributesWithoutCredentials(log.attributes)};
}
