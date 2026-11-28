import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {isPageMessage, isReadyMessage, PREVIEW_PROTOCOL} from './protocol.js';

describe('the ready message, the part of the protocol every version holds', () => {
  it('is its type with a protocol number, whatever else it carries or leaves out', () => {
    assert.equal(isReadyMessage({type: 'a2ui-spectra-preview/ready', protocol: 1}), true);
    assert.equal(
      isReadyMessage({type: 'a2ui-spectra-preview/ready', protocol: PREVIEW_PROTOCOL, claims: []}),
      true,
    );
    assert.equal(
      isReadyMessage({type: 'a2ui-spectra-preview/ready', protocol: 3, adapters: ['react']}),
      true,
    );
  });

  it('is not one whose protocol is not a number', () => {
    for (const protocol of ['2', undefined, null, [2]]) {
      const message = {type: 'a2ui-spectra-preview/ready', protocol, claims: []};
      assert.equal(isReadyMessage(message), false, JSON.stringify(protocol));
      assert.equal(isPageMessage(message), false, JSON.stringify(protocol));
    }
    assert.equal(isReadyMessage({type: 'a2ui-spectra-preview/pong', protocol: 2}), false);
    assert.equal(isReadyMessage(null), false);
  });
});

describe('a page message', () => {
  const action = {
    name: 'book',
    surfaceId: 'main',
    sourceComponentId: 'book_button',
    timestamp: '2026-10-28T09:00:00.000Z',
    context: {partySize: 2},
  };
  const valid = [
    {type: 'a2ui-spectra-preview/ready', protocol: 1, adapters: ['react']},
    {
      type: 'a2ui-spectra-preview/ready',
      protocol: PREVIEW_PROTOCOL,
      claims: [{catalogId: 'https://example.com/catalog.json', protocolVersion: '0.9'}],
    },
    {type: 'a2ui-spectra-preview/pong', load: 3},
    {type: 'a2ui-spectra-preview/report', render: 1, report: {kind: 'component', error: 'E'}},
    {
      type: 'a2ui-spectra-preview/report',
      render: 1,
      report: {kind: 'component', componentId: 'a', componentType: 'Text', error: 'E'},
    },
    {
      type: 'a2ui-spectra-preview/report',
      render: 1,
      report: {kind: 'surface', code: 'C', error: 'E', componentId: 'a'},
    },
    {
      type: 'a2ui-spectra-preview/report',
      render: 1,
      report: {kind: 'refused', index: 0, code: 'C', error: 'E'},
    },
    {type: 'a2ui-spectra-preview/data-model', render: 1, surfaceId: 'main', dataModel: null},
    {type: 'a2ui-spectra-preview/action', render: 1, action, dataModel: {}},
    {
      type: 'a2ui-spectra-preview/action',
      render: 1,
      action: {...action, catalogId: 'https://example.com/catalog.json', userMessage: 'Book it'},
      dataModel: {},
    },
  ];

  it('is one of the five a page sends, with the fields its type has', () => {
    for (const message of valid)
      assert.equal(isPageMessage(message), true, JSON.stringify(message));
  });

  it('is not one whose fields are not those of its type', () => {
    const invalid = [
      null,
      {type: 'something else'},
      {type: 'a2ui-spectra-preview/render', render: 1, surfaceId: 'main', messages: []},
      {type: 'a2ui-spectra-preview/ready', protocol: PREVIEW_PROTOCOL},
      {type: 'a2ui-spectra-preview/ready', protocol: PREVIEW_PROTOCOL, claims: [null]},
      {type: 'a2ui-spectra-preview/ready', protocol: PREVIEW_PROTOCOL, claims: [{catalogId: 1}]},
      {type: 'a2ui-spectra-preview/pong', load: '3'},
      {type: 'a2ui-spectra-preview/report', render: 1, report: null},
      {type: 'a2ui-spectra-preview/report', render: '1', report: {kind: 'component', error: 'E'}},
      {type: 'a2ui-spectra-preview/report', render: 1, report: {kind: 'component'}},
      {type: 'a2ui-spectra-preview/report', render: 1, report: {kind: 'other', error: 'E'}},
      {
        type: 'a2ui-spectra-preview/report',
        render: 1,
        report: {kind: 'component', componentId: 7, error: 'E'},
      },
      {type: 'a2ui-spectra-preview/report', render: 1, report: {kind: 'surface', error: 'E'}},
      {
        type: 'a2ui-spectra-preview/report',
        render: 1,
        report: {kind: 'refused', index: '0', code: 'C', error: 'E'},
      },
      {type: 'a2ui-spectra-preview/data-model', render: 1, dataModel: {}},
      {type: 'a2ui-spectra-preview/data-model', render: 1, surfaceId: 'main'},
      {type: 'a2ui-spectra-preview/action', render: 1, action: null, dataModel: {}},
      {type: 'a2ui-spectra-preview/action', render: 1, action},
      {
        type: 'a2ui-spectra-preview/action',
        render: 1,
        action: {...action, surfaceId: undefined},
        dataModel: {},
      },
      {
        type: 'a2ui-spectra-preview/action',
        render: 1,
        action: {...action, context: null},
        dataModel: {},
      },
      {
        type: 'a2ui-spectra-preview/action',
        render: 1,
        action: {...action, userMessage: 3},
        dataModel: {},
      },
    ];
    for (const message of invalid) {
      assert.equal(isPageMessage(message), false, JSON.stringify(message));
    }
  });
});
