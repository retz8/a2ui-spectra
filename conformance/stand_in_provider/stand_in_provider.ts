/**
 * The stand-in provider: a server that replays recorded model API traffic at
 * one origin, for the four APIs the model proxy reads in full and for any
 * other call. It answers each request with the next recorded response, in
 * the order of the HAR files given, sends a stream in pieces, and answers a
 * request it did not expect with a 599 naming what it expected.
 *
 * A request is expected when its method and path match the next recorded
 * request's, the parameters that carry credentials (`key`, `api_key`,
 * `access_token`, and any whose name contains key, token, secret, auth,
 * password or cookie) left out of both. A response whose recording carries
 * HAR's custom field `_brokenOff` breaks off after its bytes, as the
 * recording did.
 *
 * Options:
 *   --port <n>     The port to listen on, on 127.0.0.1. Default: $PORT, or 9830.
 *   --har <file>   A HAR 1.2 file to play. Can be repeated; the files play in order.
 *
 * Run from conformance/ after `yarn build`: `node dist/stand_in_provider/stand_in_provider.js
 * --port 9830 --har test_data/model_capture/v0_1/<entry>/<conversation>.har`.
 */

import {readFileSync} from 'node:fs';
import {createServer, type ServerResponse} from 'node:http';
import {parseArgs} from 'node:util';

interface HarHeader {
  name: string;
  value: string;
}

interface HarEntry {
  request: {method: string; url: string; headers: HarHeader[]; postData?: {text: string}};
  response: {
    status: number;
    statusText: string;
    headers: HarHeader[];
    content: {text: string};
    /** Set when the connection broke before the response ended: the text is what arrived. */
    _brokenOff?: boolean;
  };
}

/** Bytes per write when a recorded body is sent, so streams arrive in pieces. */
const CHUNK_BYTES = 97;

const CREDENTIAL_PARAMETERS = new Set(['key', 'api_key', 'access_token']);
const CREDENTIAL_PATTERN = /key|token|secret|auth|password|cookie/i;

/** A request's method and path, the credential parameters left out, as a request is matched. */
function requestKey(method: string, url: string): string {
  const parsed = new URL(url, 'http://stand-in');
  const kept = [...parsed.searchParams.entries()].filter(
    ([name]) => !CREDENTIAL_PARAMETERS.has(name.toLowerCase()) && !CREDENTIAL_PATTERN.test(name),
  );
  const query = kept.length === 0 ? '' : `?${new URLSearchParams(kept).toString()}`;
  return `${method} ${parsed.pathname}${query}`;
}

/** Sends a recorded body in pieces, then ends it, or breaks the connection where the recording broke off. */
async function writeInChunks(
  response: ServerResponse,
  body: Buffer,
  brokenOff: boolean,
): Promise<void> {
  for (let start = 0; start < body.length; start += CHUNK_BYTES) {
    response.write(body.subarray(start, start + CHUNK_BYTES));
    await new Promise(resolve => setImmediate(resolve));
  }
  if (brokenOff) {
    await new Promise(resolve => setTimeout(resolve, 20));
    response.socket?.destroy();
  } else {
    response.end();
  }
}

function main(): void {
  const {values} = parseArgs({
    options: {
      port: {type: 'string'},
      har: {type: 'string', multiple: true},
    },
  });
  const port = Number(values.port ?? process.env.PORT ?? 9830);
  const files = values.har ?? [];
  if (files.length === 0) {
    process.stderr.write('The stand-in provider needs at least one --har file.\n');
    process.exit(2);
  }
  const queue: HarEntry[] = files.flatMap(
    file => (JSON.parse(readFileSync(file, 'utf8')) as {log: {entries: HarEntry[]}}).log.entries,
  );

  const server = createServer((request, response) => {
    request.resume();
    request.once('end', () => {
      const actual = requestKey(request.method ?? 'GET', request.url ?? '/');
      const entry = queue[0];
      const expected = entry && requestKey(entry.request.method, entry.request.url);
      if (entry === undefined || expected !== actual) {
        process.stderr.write(`unexpected: ${actual}; expected ${expected ?? 'no request'}\n`);
        response.writeHead(599, {'content-type': 'text/plain; charset=utf-8'});
        response.end(
          `The stand-in provider expected ${expected ?? 'no more requests'}, not ${actual}.\n`,
        );
        return;
      }
      queue.shift();
      process.stderr.write(`${actual} -> ${entry.response.status}\n`);
      const body = Buffer.from(entry.response.content.text, 'utf8');
      const brokenOff = entry.response._brokenOff === true;
      response.writeHead(entry.response.status, entry.response.statusText, [
        ...entry.response.headers.flatMap(({name, value}) => [name, value]),
        ...(brokenOff ? [] : ['content-length', String(body.length)]),
      ]);
      void writeInChunks(response, body, brokenOff);
    });
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(
      `Spectra stand-in provider at http://127.0.0.1:${port}, ${queue.length} exchanges to play\n`,
    );
  });
}

main();
