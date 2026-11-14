/**
 * What the model capture suite and the model replay suite share: the
 * conformance directory, a HAR recording's entries, sending one recorded
 * request through the model proxy under its host's prefix, and the
 * comparison of a model call event with the expected record's.
 */
import * as fs from 'node:fs';
import {request as httpRequest} from 'node:http';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {Variable} from '../model_proxy/redirection.js';
import {isEventOfKind, type ModelCallEvent, type Turn} from '../record/turn_record.js';

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarEntry {
  request: {method: string; url: string; headers: HarHeader[]; postData?: {text: string}};
  response: {
    status: number;
    statusText: string;
    headers: HarHeader[];
    content: {text: string};
    _brokenOff?: boolean;
  };
}

/** Walks up from this file until it finds the shared conformance directory. */
function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, 'conformance', 'conformance_schema.json');
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

export const CONFORMANCE_DIR = findConformanceDir();

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8')) as T;
}

/** What Spectra generates rather than reads off the traffic, which the comparison skips. */
const GENERATED_FIELDS = new Set([
  'traceId',
  'spanId',
  'parentSpanId',
  'startTimeUnixNano',
  'endTimeUnixNano',
]);
/** Timings, where the request went, and the headers the replay adds. */
const GENERATED_ATTRIBUTES = new Set([
  'gen_ai.response.time_to_first_chunk',
  'server.address',
  'server.port',
  'http.request.header.host',
  'http.request.header.content-length',
  'http.request.header.connection',
  'http.response.header.date',
  'http.response.header.content-length',
]);

/** The variable's prefix each provider's host is sent under, and the path the target base already holds. */
export const PREFIXES: Record<string, {variable: Variable; basePath: string}> = {
  'generativelanguage.googleapis.com': {variable: 'GOOGLE_GEMINI_BASE_URL', basePath: ''},
  'api.openai.com': {variable: 'OPENAI_BASE_URL', basePath: '/v1'},
  'api.anthropic.com': {variable: 'ANTHROPIC_BASE_URL', basePath: ''},
};

/** What the agent's side received for one request. */
export interface Received {
  status: number;
  contentType: string;
  body: string;
  brokenOff: boolean;
}

/** One recorded request sent to the proxy under its host's prefix, with its body as given; resolves with what the agent's side received. */
export function sendEntry(
  proxyOrigin: string,
  entry: HarEntry,
  body: string | undefined = entry.request.postData?.text,
): Promise<Received> {
  const origin = new URL(proxyOrigin);
  const url = new URL(entry.request.url);
  const prefix = PREFIXES[url.hostname] ?? {variable: 'OPENAI_BASE_URL', basePath: '/v1'};
  const rest = url.pathname.startsWith(prefix.basePath)
    ? url.pathname.slice(prefix.basePath.length)
    : url.pathname;
  const headers = Object.fromEntries(
    entry.request.headers
      .filter(({name}) => name.toLowerCase() !== 'content-length')
      .map(({name, value}) => [name, value]),
  );
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: origin.hostname,
        port: origin.port,
        method: entry.request.method,
        path: `/${prefix.variable}${rest}${url.search}`,
        headers,
      },
      response => {
        const chunks: Buffer[] = [];
        const answer = (brokenOff: boolean) =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: String(response.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks).toString('utf8'),
            brokenOff,
          });
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () => answer(false));
        response.once('aborted', () => answer(true));
        response.once('error', () => answer(true));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

/** An event with what Spectra generates left out, and the request's origin replaced by a marker. */
export function comparable(event: ModelCallEvent): unknown {
  const attributes = Object.fromEntries(
    Object.entries(event.attributes)
      .filter(([name]) => !GENERATED_ATTRIBUTES.has(name))
      .map(([name, value]) =>
        name === 'url.full' && typeof value === 'string'
          ? [name, value.replace(/^https?:\/\/[^/]+/, '<origin>')]
          : [name, value],
      ),
  );
  const fields = Object.fromEntries(
    Object.entries(event).filter(([key]) => !GENERATED_FIELDS.has(key)),
  );
  return {
    ...fields,
    attributes,
    ...(event.events && {
      events: event.events.map(({timeUnixNano: _time, ...rest}) => rest),
    }),
  };
}

export function modelCalls(turn: Turn): ModelCallEvent[] {
  return turn.events.filter((event): event is ModelCallEvent => isEventOfKind(event, 'model_call'));
}
