/**
 * The HTTP exchange a proxy records on a call's event: the method, the URL
 * and the headers with credentials removed, the server, the status, and the
 * bodies that are JSON, text or form-encoded.
 */
import type {IncomingHttpHeaders, OutgoingHttpHeaders} from 'node:http';

import type {SpanEvent} from '../record/turn_record.js';
import {removeFromHeaders, removeFromUrl} from './credentials.js';

/**
 * Headers that belong to one connection, which a proxy does not pass on
 * (RFC 9110, section 7.6.1), with any the Connection header names.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** The end-to-end headers of a message, as Node parsed them. */
export function endToEndHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const named = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase()),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name) && !named.has(name)),
  );
}

/** Outgoing headers as a record of string arrays, names lowercased, for the record. */
export function headerLists(headers: OutgoingHttpHeaders): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    lists[name.toLowerCase()] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return lists;
}

/** Whether a body of this content type is kept in the exchange: JSON, text or form-encoded. */
export function bodyKept(contentType: string | undefined): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return (
    type === 'application/json' ||
    type.endsWith('+json') ||
    type.startsWith('text/') ||
    type === 'application/x-www-form-urlencoded'
  );
}

/** A body as the record holds it: its parsed JSON value when it is JSON, its text otherwise. */
export function bodyValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The request's exchange attributes, credentials removed. */
export function requestAttributes(
  method: string,
  url: URL,
  headers: OutgoingHttpHeaders,
  body: string | undefined,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    'http.request.method': method,
    'url.full': removeFromUrl(url.href),
  };
  for (const [name, values] of Object.entries(removeFromHeaders(headerLists(headers), 'request'))) {
    attributes[`http.request.header.${name}`] = values;
  }
  attributes['server.address'] = url.hostname;
  attributes['server.port'] = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (body !== undefined && bodyKept(String(headers['content-type'] ?? ''))) {
    attributes['a2ui.http.request.body'] = bodyValue(body);
  }
  return attributes;
}

/** The response's exchange attributes: the status and the headers, and the body when it was not streamed. */
export function responseAttributes(
  status: number,
  headers: IncomingHttpHeaders,
  body: string | undefined,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const [name, values] of Object.entries(
    removeFromHeaders(headerLists(endToEndHeaders(headers)), 'response'),
  )) {
    attributes[`http.response.header.${name}`] = values;
  }
  attributes['http.response.status_code'] = status;
  if (body !== undefined && bodyKept(String(headers['content-type'] ?? ''))) {
    attributes['a2ui.http.response.body'] = bodyValue(body);
  }
  return attributes;
}

/** One server-sent event of a streamed response, as a span event. */
export function chunkEvent(
  timeUnixNano: string,
  chunk: {event?: string; id?: string; data: string},
): SpanEvent {
  return {
    timeUnixNano,
    name: 'a2ui.http.response.chunk',
    attributes: {
      'a2ui.http.response.chunk.body': bodyValue(chunk.data),
      ...(chunk.event !== undefined && {'a2ui.http.response.chunk.event': chunk.event}),
      ...(chunk.id !== undefined && {'a2ui.http.response.chunk.id': chunk.id}),
    },
  };
}
