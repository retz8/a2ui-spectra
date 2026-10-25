import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {type CardDetails, cardDetailsOf, checkTransport, isCardPath, rewriteCard} from './card.js';

const proxy = 'http://127.0.0.1:9821';

describe('rewriteCard', () => {
  it("replaces the origin of an A2A 0.3 card's url, keeping its path exactly", () => {
    assert.deepEqual(
      rewriteCard({name: 'Restaurant Agent', url: 'http://localhost:10002', version: '1'}, proxy),
      {name: 'Restaurant Agent', url: 'http://127.0.0.1:9821', version: '1'},
    );
    assert.deepEqual(rewriteCard({url: 'http://localhost:10002/a2a/json-rpc'}, proxy), {
      url: 'http://127.0.0.1:9821/a2a/json-rpc',
    });
    assert.deepEqual(rewriteCard({url: 'https://agent.example.com/a/?x=1'}, proxy), {
      url: 'http://127.0.0.1:9821/a/?x=1',
    });
  });

  it('rewrites the JSON-RPC entries of additionalInterfaces, and leaves the others', () => {
    assert.deepEqual(
      rewriteCard(
        {
          url: 'http://localhost:10002/',
          preferredTransport: 'JSONRPC',
          additionalInterfaces: [
            {url: 'http://localhost:10002/', transport: 'JSONRPC'},
            {url: 'localhost:50051', transport: 'GRPC'},
            {url: 'http://localhost:10002/v1', transport: 'HTTP+JSON'},
          ],
        },
        proxy,
      ),
      {
        url: 'http://127.0.0.1:9821/',
        preferredTransport: 'JSONRPC',
        additionalInterfaces: [
          {url: 'http://127.0.0.1:9821/', transport: 'JSONRPC'},
          {url: 'localhost:50051', transport: 'GRPC'},
          {url: 'http://localhost:10002/v1', transport: 'HTTP+JSON'},
        ],
      },
    );
  });

  it('rewrites the JSON-RPC entries of an A2A 1.0 card, and leaves the others', () => {
    assert.deepEqual(
      rewriteCard(
        {
          name: 'Coffee',
          supportedInterfaces: [
            {
              url: 'https://coffee.example/a2a/grpc',
              protocolBinding: 'GRPC',
              protocolVersion: '1.0',
            },
            {url: 'http://localhost:5000/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
          ],
        },
        proxy,
      ),
      {
        name: 'Coffee',
        supportedInterfaces: [
          {url: 'https://coffee.example/a2a/grpc', protocolBinding: 'GRPC', protocolVersion: '1.0'},
          {url: 'http://127.0.0.1:9821/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
        ],
      },
    );
  });

  it('leaves a url that is not an absolute URL alone', () => {
    assert.deepEqual(rewriteCard({url: '/relative'}, proxy), {url: '/relative'});
  });
});

describe('checkTransport', () => {
  it('accepts a card whose preferred transport is JSON-RPC, stated or by default', () => {
    assert.deepEqual(checkTransport({url: 'http://a/', preferredTransport: 'JSONRPC'}), {
      kind: 'jsonrpc_first',
    });
    assert.deepEqual(checkTransport({url: 'http://a/'}), {kind: 'jsonrpc_first'});
    assert.deepEqual(
      checkTransport({
        supportedInterfaces: [
          {url: 'http://a/', protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
        ],
      }),
      {kind: 'jsonrpc_first'},
    );
  });

  it('names the preferred transport when JSON-RPC is listed but not first', () => {
    assert.deepEqual(
      checkTransport({
        url: 'grpc.example:443',
        preferredTransport: 'GRPC',
        additionalInterfaces: [{url: 'http://a/', transport: 'JSONRPC'}],
      }),
      {kind: 'jsonrpc_later', preferred: 'GRPC'},
    );
    assert.deepEqual(
      checkTransport({
        supportedInterfaces: [
          {url: 'http://a/v1', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0'},
          {url: 'http://a/', protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
        ],
      }),
      {kind: 'jsonrpc_later', preferred: 'HTTP+JSON'},
    );
  });

  it('lists the transports when there is no JSON-RPC interface', () => {
    assert.deepEqual(
      checkTransport({
        url: 'grpc.example:443',
        preferredTransport: 'GRPC',
        additionalInterfaces: [{url: 'http://a/v1', transport: 'HTTP+JSON'}],
      }),
      {kind: 'no_jsonrpc', transports: ['GRPC', 'HTTP+JSON']},
    );
    assert.deepEqual(
      checkTransport({
        supportedInterfaces: [{url: 'http://a/', protocolBinding: 'GRPC', protocolVersion: '1.0'}],
      }),
      {kind: 'no_jsonrpc', transports: ['GRPC']},
    );
  });

  it('tells a card that lists no interface at all from one without JSON-RPC', () => {
    assert.deepEqual(checkTransport({name: 'No interfaces'}), {kind: 'no_interface'});
    assert.deepEqual(checkTransport({name: 'Empty', supportedInterfaces: []}), {
      kind: 'no_interface',
    });
  });
});

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

const RECORDINGS = path.join(findConformanceDir(), 'test_data/a2a_capture/v0_1');

/** The first agent card a HAR recording holds. */
function recordedCard(file: string): Record<string, unknown> {
  const har = JSON.parse(fs.readFileSync(path.join(RECORDINGS, file), 'utf8')) as {
    log: {entries: Array<{request: {url: string}; response: {content: {text?: string}}}>};
  };
  const entry = har.log.entries.find(
    ({request, response}) =>
      isCardPath(new URL(request.url).pathname) && Boolean(response.content.text),
  );
  assert.ok(entry, `${file} holds no agent card`);
  return JSON.parse(entry.response.content.text ?? '') as Record<string, unknown>;
}

const BASIC_V0_9 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const BASIC_V1_0 = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const STANDARD_V0_8 = 'https://a2ui.org/specification/v0_8/standard_catalog_definition.json';
const RESTAURANT_EXAMPLE = 'Find me the top 10 chinese restaurants in the US';

describe('cardDetailsOf', () => {
  it("reads the A2A versions, the A2UI extensions and each skill's first example of the coverage roster's cards", () => {
    const expected: Record<string, CardDetails> = {
      'a2term_examplesvc/send_multipart_and_tagged_text.har': {
        a2aVersions: ['1.0'],
        a2uiExtensions: [],
        examples: [],
      },
      'a2uiverse_circleci/runs_then_confirm_rerun.har': {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [
          {
            version: 'v0.9.1',
            catalogIds: [
              'https://github.com/retz8/a2uiverse-apps/blob/main/circleci/circleci-catalog/catalogs/v0.9.1/catalog.json',
            ],
          },
        ],
        examples: [
          'How are my builds doing?',
          'Open the latest run on main',
          'Why did the build fail?',
          'Rerun the failed workflow',
        ],
      },
      'ag2/send_v0_9_1_card.har': {
        a2aVersions: ['1.0'],
        a2uiExtensions: [{version: 'v0.9.1', catalogIds: [BASIC_V0_9]}],
        examples: [],
      },
      'ag2/stream_v1_0_failed.har': {
        a2aVersions: ['1.0'],
        a2uiExtensions: [{version: 'v1.0', catalogIds: [BASIC_V1_0]}],
        examples: [],
      },
      'ag2/stream_v1_0_function_call.har': {
        a2aVersions: ['1.0'],
        a2uiExtensions: [{version: 'v1.0', catalogIds: [BASIC_V1_0]}],
        examples: [],
      },
      'angular_client/python_restaurant_finder_booking.har': {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [
          {version: 'v0.8', catalogIds: [STANDARD_V0_8]},
          {version: 'v0.9', catalogIds: [BASIC_V0_9]},
        ],
        examples: [RESTAURANT_EXAMPLE],
      },
      'custom_components/action_then_model_turn.har': {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [
          {version: 'v0.8', catalogIds: [STANDARD_V0_8]},
          {version: 'v0.9', catalogIds: [BASIC_V0_9]},
        ],
        examples: ['Who is David Chen in marketing?'],
      },
      'file_upload_summarizer/artifact_stream_and_send.har': {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [
          {
            version: 'v0.9',
            catalogIds: [
              'https://a2ui.org/samples/community/agent/adk/file_upload_summarizer/catalogs/0.9/file_upload_catalog.json',
            ],
          },
        ],
        examples: ['show file uploader', 'mockdrive://file-id'],
      },
      'node_restaurant_finder/send_task_history_and_failed.har': {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [],
        examples: [RESTAURANT_EXAMPLE],
      },
      'node_restaurant_finder/stream_v1_0_booking.har': {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [],
        examples: [RESTAURANT_EXAMPLE],
      },
      'react_client/node_restaurant_finder_text_and_action.har': {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [],
        examples: [RESTAURANT_EXAMPLE],
      },
      'strathweb_booking_wizard/send_then_stream.har': {
        a2aVersions: [],
        a2uiExtensions: [{version: 'v0.9.1', catalogIds: [BASIC_V0_9]}],
        examples: [],
      },
      'stub_agent/cancel_a2a_0_3.har': {
        a2aVersions: ['1.0', '0.3'],
        a2uiExtensions: [],
        examples: ['start'],
      },
      'stub_agent/cancel_a2a_1_0.har': {
        a2aVersions: ['1.0', '0.3'],
        a2uiExtensions: [],
        examples: ['start'],
      },
      'stub_agent/flawed_booking_a2a_1_0.har': {
        a2aVersions: ['1.0', '0.3'],
        a2uiExtensions: [],
        examples: ['Book a table for two at Han Il Kwan tonight'],
      },
    };
    const files = fs
      .readdirSync(RECORDINGS, {recursive: true, encoding: 'utf8'})
      .filter(file => file.endsWith('.har'))
      .sort();
    assert.deepEqual(files, Object.keys(expected).sort());
    for (const file of files) {
      assert.deepEqual(cardDetailsOf(recordedCard(file)), expected[file], file);
    }
  });

  it("reads only the JSON-RPC entries' versions of an A2A 1.0 card, once each", () => {
    assert.deepEqual(
      cardDetailsOf({
        supportedInterfaces: [
          {url: 'https://coffee.example/grpc', protocolBinding: 'GRPC', protocolVersion: '1.1'},
          {url: 'http://localhost:5000/a', protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
          {url: 'http://localhost:5000/b', protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
          {url: 'http://localhost:5000/c', protocolBinding: 'JSONRPC'},
        ],
      }).a2aVersions,
      ['1.0'],
    );
  });

  it('skips extensions that are not A2UI, catalog ids that are not text, and blank examples', () => {
    assert.deepEqual(
      cardDetailsOf({
        protocolVersion: '0.3.0',
        capabilities: {
          extensions: [
            {uri: 'urn:ag2:client-tools:v1'},
            {uri: 'https://a2ui.org/a2a-extension/a2ui/v1.0'},
            {
              uri: 'https://a2ui.org/a2a-extension/a2ui/v0.9',
              params: {supportedCatalogIds: [BASIC_V0_9, 7, '']},
            },
          ],
        },
        skills: [
          {id: 'none'},
          {id: 'blank', examples: ['  ', '  Book a table  ']},
          {id: 'odd', examples: [3]},
        ],
      }),
      {
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [
          {version: 'v1.0', catalogIds: []},
          {version: 'v0.9', catalogIds: [BASIC_V0_9]},
        ],
        examples: ['Book a table'],
      },
    );
  });
});
