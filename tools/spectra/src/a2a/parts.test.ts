import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {a2aPart, wirePart} from './parts.js';

const surface = {version: 'v0.9', createSurface: {surfaceId: 's1', catalogId: 'basic'}};

describe('wirePart, A2A 0.3', () => {
  it('maps a text part, keeping its metadata', () => {
    assert.deepEqual(wirePart({kind: 'text', text: 'Hello'}, '0.3'), {
      type: 'text',
      content: 'Hello',
    });
    assert.deepEqual(wirePart({kind: 'text', text: 'Hello', metadata: {lang: 'en'}}, '0.3'), {
      type: 'text',
      content: 'Hello',
      metadata: {lang: 'en'},
    });
  });

  it('maps a file with bytes to a blob, its modality from the MIME type', () => {
    assert.deepEqual(
      wirePart(
        {kind: 'file', file: {bytes: 'iVBORw0K', mimeType: 'image/png', name: 'chart.png'}},
        '0.3',
      ),
      {
        type: 'blob',
        modality: 'image',
        mime_type: 'image/png',
        content: 'iVBORw0K',
        name: 'chart.png',
      },
    );
  });

  it('maps a file with a URI to a uri part, a document unless image, video or audio', () => {
    assert.deepEqual(
      wirePart(
        {kind: 'file', file: {uri: 'https://example.com/menu.pdf', mimeType: 'application/pdf'}},
        '0.3',
      ),
      {
        type: 'uri',
        modality: 'document',
        mime_type: 'application/pdf',
        uri: 'https://example.com/menu.pdf',
      },
    );
    assert.deepEqual(wirePart({kind: 'file', file: {uri: 'https://example.com/clip'}}, '0.3'), {
      type: 'uri',
      modality: 'document',
      uri: 'https://example.com/clip',
    });
    assert.deepEqual(
      wirePart(
        {kind: 'file', file: {uri: 'https://example.com/a.ogg', mimeType: 'audio/ogg'}},
        '0.3',
      ),
      {type: 'uri', modality: 'audio', mime_type: 'audio/ogg', uri: 'https://example.com/a.ogg'},
    );
  });

  it('reads the deprecated A2UI MIME type in the metadata, and drops it', () => {
    assert.deepEqual(
      wirePart({kind: 'data', data: surface, metadata: {mimeType: 'application/json+a2ui'}}, '0.3'),
      {type: 'a2ui', content: surface},
    );
  });

  it('keeps an array of A2UI messages as delivered, and the rest of the metadata', () => {
    assert.deepEqual(
      wirePart(
        {
          kind: 'data',
          data: [surface],
          metadata: {mimeType: 'application/a2ui+json', source: 'planner'},
        },
        '0.3',
      ),
      {type: 'a2ui', content: [surface], metadata: {source: 'planner'}},
    );
  });

  it('reads the A2UI MIME type on the part itself, as the Lit sample client sends it', () => {
    assert.deepEqual(
      wirePart({kind: 'data', data: surface, mimeType: 'application/a2ui+json'}, '0.3'),
      {type: 'a2ui', content: surface},
    );
  });

  it('keeps a data part without an A2UI MIME type as a data part, whatever it holds', () => {
    assert.deepEqual(wirePart({kind: 'data', data: surface}, '0.3'), {
      type: 'data',
      content: surface,
    });
    assert.deepEqual(
      wirePart(
        {
          kind: 'data',
          data: {id: 'call-1', name: 'get_restaurants', args: {cuisine: 'Chinese'}},
          metadata: {adk_type: 'function_call'},
        },
        '0.3',
      ),
      {
        type: 'data',
        content: {id: 'call-1', name: 'get_restaurants', args: {cuisine: 'Chinese'}},
        metadata: {adk_type: 'function_call'},
      },
    );
  });

  it('does not take an A2UI MIME type on a text part for A2UI', () => {
    assert.deepEqual(
      wirePart({kind: 'text', text: '{}', metadata: {mimeType: 'application/a2ui+json'}}, '0.3'),
      {type: 'text', content: '{}', metadata: {mimeType: 'application/a2ui+json'}},
    );
  });
});

describe('wirePart, A2A 1.0', () => {
  it('maps a text part, keeping its media type', () => {
    assert.deepEqual(wirePart({text: 'Hello'}, '1.0'), {type: 'text', content: 'Hello'});
    assert.deepEqual(wirePart({text: '# Menu', mediaType: 'text/markdown'}, '1.0'), {
      type: 'text',
      content: '# Menu',
      mime_type: 'text/markdown',
    });
  });

  it('maps raw bytes to a blob and a URL to a uri part, with the file name', () => {
    assert.deepEqual(
      wirePart({raw: 'UklGRg==', mediaType: 'audio/wav', filename: 'hello.wav'}, '1.0'),
      {
        type: 'blob',
        modality: 'audio',
        mime_type: 'audio/wav',
        content: 'UklGRg==',
        name: 'hello.wav',
      },
    );
    assert.deepEqual(wirePart({url: 'https://example.com/v.mp4', mediaType: 'video/mp4'}, '1.0'), {
      type: 'uri',
      modality: 'video',
      mime_type: 'video/mp4',
      uri: 'https://example.com/v.mp4',
    });
  });

  it('reads the A2UI MIME type from the metadata, as strathweb-a2ui sends it', () => {
    assert.deepEqual(
      wirePart({data: [surface], metadata: {mimeType: 'application/a2ui+json'}}, '1.0'),
      {type: 'a2ui', content: [surface]},
    );
  });

  it('reads the A2UI MIME type from the media type, and drops it from both places', () => {
    assert.deepEqual(
      wirePart(
        {
          data: [surface],
          mediaType: 'application/a2ui+json',
          metadata: {mimeType: 'application/a2ui+json'},
        },
        '1.0',
      ),
      {type: 'a2ui', content: [surface]},
    );
  });

  it('keeps other data as a data part, with its media type', () => {
    assert.deepEqual(wirePart({data: {total: 3}, mediaType: 'application/json'}, '1.0'), {
      type: 'data',
      content: {total: 3},
      mime_type: 'application/json',
    });
  });
});

/** The hand-written parts of both versions, each read into the record and written back. */
const ROUND_TRIPS: Array<['0.3' | '1.0', Record<string, unknown>]> = [
  ['0.3', {kind: 'text', text: 'Hello'}],
  ['0.3', {kind: 'text', text: 'Hello', metadata: {lang: 'en'}}],
  ['0.3', {kind: 'file', file: {bytes: 'iVBORw0K', mimeType: 'image/png', name: 'chart.png'}}],
  ['0.3', {kind: 'file', file: {uri: 'https://example.com/menu.pdf', mimeType: 'application/pdf'}}],
  ['0.3', {kind: 'file', file: {uri: 'https://example.com/clip'}}],
  ['0.3', {kind: 'data', data: surface, metadata: {mimeType: 'application/a2ui+json'}}],
  [
    '0.3',
    {
      kind: 'data',
      data: [surface],
      metadata: {mimeType: 'application/a2ui+json', source: 'planner'},
    },
  ],
  ['0.3', {kind: 'data', data: surface}],
  [
    '0.3',
    {
      kind: 'data',
      data: {id: 'call-1', name: 'get_restaurants', args: {cuisine: 'Chinese'}},
      metadata: {adk_type: 'function_call'},
    },
  ],
  ['0.3', {kind: 'text', text: '{}', metadata: {mimeType: 'application/a2ui+json'}}],
  ['0.3', {kind: 'video', url: 'https://example.com/v'}],
  ['1.0', {text: 'Hello'}],
  ['1.0', {text: '# Menu', mediaType: 'text/markdown', filename: 'menu.md'}],
  ['1.0', {raw: 'UklGRg==', mediaType: 'audio/wav', filename: 'hello.wav'}],
  ['1.0', {url: 'https://example.com/v.mp4', mediaType: 'video/mp4'}],
  ['1.0', {data: [surface], mediaType: 'application/a2ui+json'}],
  ['1.0', {data: [surface], mediaType: 'application/a2ui+json', metadata: {source: 'planner'}}],
  ['1.0', {data: {total: 3}, mediaType: 'application/json'}],
  ['1.0', {data: {total: 3}, mediaType: 'application/json', filename: 'totals.json'}],
  ['1.0', {reasoning: 'thinking'}],
];

describe('a2aPart, the record part written back as an A2A part', () => {
  for (const [version, part] of ROUND_TRIPS) {
    it(`round-trips ${JSON.stringify(part)} under A2A ${version}`, () => {
      assert.deepEqual(a2aPart(wirePart(part, version), version), part);
    });
  }

  it('writes the canonical A2UI MIME type in the metadata under A2A 0.3, whatever place or spelling it was read from', () => {
    const expected = {kind: 'data', data: surface, metadata: {mimeType: 'application/a2ui+json'}};
    assert.deepEqual(
      a2aPart(
        wirePart({kind: 'data', data: surface, mimeType: 'application/a2ui+json'}, '0.3'),
        '0.3',
      ),
      expected,
    );
    assert.deepEqual(
      a2aPart(
        wirePart(
          {kind: 'data', data: surface, metadata: {mimeType: 'application/json+a2ui'}},
          '0.3',
        ),
        '0.3',
      ),
      expected,
    );
  });

  it('writes the A2UI MIME type as the media type under A2A 1.0, whatever place it was read from', () => {
    assert.deepEqual(
      a2aPart(
        wirePart({data: [surface], metadata: {mimeType: 'application/a2ui+json'}}, '1.0'),
        '1.0',
      ),
      {data: [surface], mediaType: 'application/a2ui+json'},
    );
  });

  it("writes a part recorded under one A2A version in the other's form, dropping what it has no place for", () => {
    const recorded = wirePart(
      {text: '# Menu', mediaType: 'text/markdown', filename: 'menu.md'},
      '1.0',
    );
    assert.deepEqual(a2aPart(recorded, '0.3'), {kind: 'text', text: '# Menu'});
    const file = wirePart(
      {kind: 'file', file: {bytes: 'iVBORw0K', mimeType: 'image/png', name: 'chart.png'}},
      '0.3',
    );
    assert.deepEqual(a2aPart(file, '1.0'), {
      raw: 'iVBORw0K',
      mediaType: 'image/png',
      filename: 'chart.png',
    });
    const a2ui = wirePart(
      {kind: 'data', data: surface, metadata: {mimeType: 'application/a2ui+json'}},
      '0.3',
    );
    assert.deepEqual(a2aPart(a2ui, '1.0'), {data: surface, mediaType: 'application/a2ui+json'});
  });
});
