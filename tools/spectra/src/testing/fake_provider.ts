/**
 * A small fake model provider for the command-line test: it answers
 * Anthropic's `POST /v1/messages` with one canned message, and records the
 * headers it received.
 */
import {createServer, type IncomingHttpHeaders, type Server} from 'node:http';

/** The key the fake agent sends, which must never reach a record. */
export const FAKE_PROVIDER_KEY = 'sk-ant-test-secret-key';

export const FAKE_PROVIDER_REPLY = {
  id: 'msg_fake_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-fake-1',
  content: [{type: 'text', text: 'Hello from the fake provider.'}],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {input_tokens: 12, output_tokens: 7},
};

export interface FakeProvider {
  server: Server;
  /** The headers of each request received. */
  received: IncomingHttpHeaders[];
}

export function startFakeProvider(port: number): Promise<FakeProvider> {
  const received: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    received.push(request.headers);
    request.resume();
    request.once('end', () => {
      if (request.method === 'POST' && request.url === '/v1/messages') {
        response.writeHead(200, {'content-type': 'application/json', 'request-id': 'req_fake'});
        response.end(JSON.stringify(FAKE_PROVIDER_REPLY));
      } else {
        response.writeHead(404, {'content-type': 'application/json'});
        response.end(
          JSON.stringify({type: 'error', error: {type: 'not_found_error', message: 'Not found'}}),
        );
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({server, received}));
  });
}
