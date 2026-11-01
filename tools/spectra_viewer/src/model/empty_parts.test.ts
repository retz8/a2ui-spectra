import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {emptyNoteOf, shownParts} from './empty_parts.ts';

const call = {type: 'tool_call', id: 'call_1', name: 'list_issues', arguments: {}};

describe('shownParts', () => {
  it('leaves out text and reasoning with nothing in them', () => {
    assert.deepEqual(
      shownParts([
        {type: 'text', content: 'My issues'},
        {type: 'text', content: ''},
        {type: 'reasoning', content: ''},
      ]),
      [{type: 'text', content: 'My issues'}],
    );
  });

  it('keeps every other part, a tool call after which Gemini sends empty text among them', () => {
    assert.deepEqual(shownParts([call, {type: 'text', content: ''}]), [call]);
  });

  it('keeps text of whitespace, which is not empty', () => {
    assert.deepEqual(shownParts([{type: 'text', content: '\n'}]), [{type: 'text', content: '\n'}]);
  });
});

describe('emptyNoteOf', () => {
  it('names empty reasoning when every part is reasoning', () => {
    assert.equal(emptyNoteOf([{type: 'reasoning', content: ''}]), 'empty reasoning');
  });

  it('names empty text otherwise', () => {
    assert.equal(emptyNoteOf([{type: 'text', content: ''}]), 'empty text');
    assert.equal(
      emptyNoteOf([
        {type: 'reasoning', content: ''},
        {type: 'text', content: ''},
      ]),
      'empty text',
    );
  });
});
