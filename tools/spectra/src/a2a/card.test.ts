import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {checkTransport, rewriteCard} from './card.js';

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
    assert.deepEqual(checkTransport({name: 'No interfaces'}), {kind: 'no_jsonrpc', transports: []});
  });
});
