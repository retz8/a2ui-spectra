import {isRecord} from './protocol.js';

/** The metadata keys a host sends its A2UI capabilities under: v0.9's, then v1.0's. */
const CAPABILITIES_KEYS = ['a2uiClientCapabilities', 'a2uiRendererCapabilities'];

/** The metadata keys a host sends its A2UI data model under: v0.9's, then v1.0's. */
const DATA_MODEL_KEYS = ['a2uiClientDataModel', 'a2uiRendererDataModel'];

/** A wire input's metadata, split into the record's three attributes. */
export interface InputMetadata {
  /** The capabilities of every key, merged into one object keyed by version. */
  capabilities?: Record<string, unknown>;
  dataModel?: Record<string, unknown>;
  /** Every other key, unchanged. */
  metadata?: Record<string, unknown>;
}

/**
 * Splits a host message's metadata. When both data model keys are present,
 * the data model whose version matches the input's A2UI messages is taken
 * and the other stays in the metadata; with no A2UI message to match, v0.9's
 * key is taken.
 */
export function splitInputMetadata(
  metadata: Record<string, unknown> | undefined,
  a2uiVersion: string | undefined,
): InputMetadata {
  if (metadata === undefined) {
    return {};
  }
  const rest = {...metadata};
  let capabilities: Record<string, unknown> | undefined;
  for (const key of CAPABILITIES_KEYS) {
    const value = rest[key];
    if (isRecord(value)) {
      capabilities = {...capabilities, ...value};
      delete rest[key];
    }
  }
  const models = DATA_MODEL_KEYS.filter(key => isRecord(rest[key]));
  const modelKey =
    models.find(key => (rest[key] as Record<string, unknown>).version === a2uiVersion) ?? models[0];
  let dataModel: Record<string, unknown> | undefined;
  if (modelKey !== undefined) {
    dataModel = rest[modelKey] as Record<string, unknown>;
    delete rest[modelKey];
  }
  return {
    ...(capabilities && {capabilities}),
    ...(dataModel && {dataModel}),
    ...(Object.keys(rest).length > 0 && {metadata: rest}),
  };
}
