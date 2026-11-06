import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {joinInputMetadata, splitInputMetadata} from './metadata.js';

const clientCapabilities = {
  'v0.9': {supportedCatalogIds: ['a']},
  'v0.9.1': {supportedCatalogIds: ['a', 'b']},
};
const rendererCapabilities = {'1.0': {supportedCatalogIds: ['c']}};

describe("joinInputMetadata, the record's three attributes written back as a host message's metadata", () => {
  it('puts the v0.9 and v0.9.1 capabilities under the client key and the v1.0 ones under the renderer key', () => {
    assert.deepEqual(
      joinInputMetadata({capabilities: {...clientCapabilities, ...rendererCapabilities}}),
      {a2uiClientCapabilities: clientCapabilities, a2uiRendererCapabilities: rendererCapabilities},
    );
    assert.deepEqual(joinInputMetadata({capabilities: clientCapabilities}), {
      a2uiClientCapabilities: clientCapabilities,
    });
    assert.deepEqual(joinInputMetadata({capabilities: rendererCapabilities}), {
      a2uiRendererCapabilities: rendererCapabilities,
    });
  });

  it('puts the data model under the key its own version picks, beside the other metadata', () => {
    const v1 = {version: '1.0', surfaces: {s1: {name: 'Ada'}}};
    const v09 = {version: 'v0.9.1', surfaces: {s1: {name: 'Ada'}}};
    assert.deepEqual(joinInputMetadata({dataModel: v1, metadata: {source: 'planner'}}), {
      source: 'planner',
      a2uiRendererDataModel: v1,
    });
    assert.deepEqual(joinInputMetadata({dataModel: v09}), {a2uiClientDataModel: v09});
  });

  it('is nothing for an input that carried no metadata', () => {
    assert.equal(joinInputMetadata({}), undefined);
  });

  it('round-trips what splitInputMetadata read', () => {
    const metadata = {
      a2uiClientCapabilities: clientCapabilities,
      a2uiRendererCapabilities: rendererCapabilities,
      a2uiRendererDataModel: {version: '1.0', surfaces: {s1: {name: 'Ada'}}},
      source: 'planner',
    };
    assert.deepEqual(joinInputMetadata(splitInputMetadata(metadata, '1.0')), metadata);
    const split = {
      capabilities: {...clientCapabilities, ...rendererCapabilities},
      dataModel: {version: 'v0.9', surfaces: {}},
      metadata: {source: 'planner'},
    };
    assert.deepEqual(splitInputMetadata(joinInputMetadata(split), 'v0.9'), split);
  });
});
