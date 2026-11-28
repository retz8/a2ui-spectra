import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {resultShownOf} from './tool_calls.ts';

describe('resultShownOf', () => {
  it('shows a JSON-RPC error as JSON, labelled Error, with its code after the source', () => {
    assert.deepEqual(
      resultShownOf(
        {value: {code: -32601, message: 'Method not found'}, error: true, code: -32601},
        'Tool proxy',
      ),
      {
        form: 'json',
        label: 'Error',
        meta: 'Tool proxy · JSON-RPC -32601',
        value: {code: -32601, message: 'Method not found'},
      },
    );
  });

  it('shows a tool’s content as parts, its text blocks first, then the rest and the structured content', () => {
    const image = {type: 'image', data: 'QQ==', mimeType: 'image/png'};
    assert.deepEqual(
      resultShownOf(
        {
          value: {
            content: [image, {type: 'text', text: 'Two places.'}],
            structuredContent: {places: 2},
          },
          error: false,
        },
        undefined,
      ),
      {
        form: 'parts',
        label: 'Result',
        meta: 'image, text',
        parts: [{text: 'Two places.'}, {json: image}, {json: {places: 2}}],
      },
    );
  });

  it('labels the tool’s own error as Error', () => {
    const shown = resultShownOf(
      {value: {content: [{type: 'text', text: 'No such place.'}], isError: true}, error: true},
      'MCP',
    );
    assert.equal(shown.label, 'Error');
    assert.equal(shown.meta, 'MCP · text');
  });

  it('shows a resource’s contents as parts, with the first one’s media type and URI', () => {
    assert.deepEqual(
      resultShownOf(
        {
          value: {
            contents: [
              {uri: 'file:///plan.svg', mimeType: 'image/svg+xml', text: '<svg/>'},
              {uri: 'file:///raw', blob: 'QQ=='},
            ],
          },
          error: false,
        },
        'Tool proxy',
      ),
      {
        form: 'parts',
        label: 'Result',
        meta: 'Tool proxy · image/svg+xml · file:///plan.svg',
        parts: [{text: '<svg/>'}, {json: {uri: 'file:///raw', blob: 'QQ=='}}],
      },
    );
  });

  it('shows anything else as JSON, with the source alone', () => {
    assert.deepEqual(resultShownOf({value: [1, 2], error: false}, 'HTTP tool'), {
      form: 'json',
      label: 'Result',
      meta: 'HTTP tool',
      value: [1, 2],
    });
    assert.equal(resultShownOf({value: 'ok', error: false}, undefined).meta, '');
  });
});
