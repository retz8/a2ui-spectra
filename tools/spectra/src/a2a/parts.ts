import type {Modality, WirePart} from '../record/turn_record.js';
import {type A2aVersion, isRecord} from './protocol.js';

/**
 * The MIME types that mark a data part as A2UI: the extension
 * specification's, and the deprecated spelling upstream's Python A2A
 * extension still writes.
 */
const A2UI_MIME_TYPES = new Set(['application/a2ui+json', 'application/json+a2ui']);

function isA2uiMimeType(value: unknown): boolean {
  return typeof value === 'string' && A2UI_MIME_TYPES.has(value.split(';')[0].trim().toLowerCase());
}

/**
 * One A2A part as a turn record part. Text, files and other data take
 * GenAI's part types; a data part with an A2UI MIME type, in its metadata or
 * on the part itself, is an A2UI part. A file's name and the part's metadata,
 * less the A2UI MIME type once read, stay on the part.
 */
export function wirePart(part: unknown, version: A2aVersion): WirePart {
  if (!isRecord(part)) {
    return {type: 'unknown', content: part};
  }
  return version === '0.3' ? fromV03(part) : fromV10(part);
}

function fromV03(part: Record<string, unknown>): WirePart {
  const metadata = isRecord(part.metadata) ? part.metadata : undefined;
  switch (part.kind) {
    case 'text':
      return withExtras({type: 'text', content: part.text}, {metadata});
    case 'file': {
      const file = isRecord(part.file) ? part.file : {};
      return fileOrUnknown(part, {
        bytes: file.bytes,
        uri: file.uri,
        mimeType: file.mimeType,
        name: file.name,
        metadata,
      });
    }
    case 'data':
      return dataPart(part.data, part.mimeType, metadata);
    default:
      return {type: typeof part.kind === 'string' ? part.kind : 'unknown', content: part};
  }
}

function fromV10(part: Record<string, unknown>): WirePart {
  const metadata = isRecord(part.metadata) ? part.metadata : undefined;
  if ('text' in part) {
    return withExtras(
      {type: 'text', content: part.text},
      {metadata, mimeType: part.mediaType, name: part.filename},
    );
  }
  if ('raw' in part || 'url' in part) {
    return fileOrUnknown(part, {
      bytes: part.raw,
      uri: part.url,
      mimeType: part.mediaType,
      name: part.filename,
      metadata,
    });
  }
  if ('data' in part) {
    return dataPart(part.data, part.mediaType, metadata, part.filename);
  }
  return {type: 'unknown', content: part};
}

interface FileFields {
  bytes: unknown;
  uri: unknown;
  mimeType: unknown;
  name: unknown;
  metadata: Record<string, unknown> | undefined;
}

function fileOrUnknown(part: Record<string, unknown>, file: FileFields): WirePart {
  const mimeType = typeof file.mimeType === 'string' ? file.mimeType : undefined;
  const modality = modalityOf(mimeType);
  const extras = {metadata: file.metadata, name: file.name};
  if (typeof file.bytes === 'string') {
    return withExtras(
      {type: 'blob', modality, ...(mimeType && {mime_type: mimeType}), content: file.bytes},
      extras,
    );
  }
  if (typeof file.uri === 'string') {
    return withExtras(
      {type: 'uri', modality, ...(mimeType && {mime_type: mimeType}), uri: file.uri},
      extras,
    );
  }
  return {type: 'unknown', content: part};
}

function dataPart(
  data: unknown,
  partMimeType: unknown,
  metadata: Record<string, unknown> | undefined,
  name?: unknown,
): WirePart {
  if (isA2uiMimeType(partMimeType) || isA2uiMimeType(metadata?.mimeType)) {
    const rest = isA2uiMimeType(metadata?.mimeType) ? withoutKey(metadata, 'mimeType') : metadata;
    return withExtras({type: 'a2ui', content: data}, {metadata: rest, name});
  }
  return withExtras({type: 'data', content: data}, {metadata, mimeType: partMimeType, name});
}

/** GenAI's modality for a MIME type: its top level when a medium, else a document. */
function modalityOf(mimeType: string | undefined): Modality {
  const top = mimeType?.split('/')[0].trim().toLowerCase();
  return top === 'image' || top === 'video' || top === 'audio' ? top : 'document';
}

interface Extras {
  metadata?: Record<string, unknown>;
  mimeType?: unknown;
  name?: unknown;
}

function withExtras(part: WirePart, {metadata, mimeType, name}: Extras): WirePart {
  const result: Record<string, unknown> = {...part};
  if (typeof mimeType === 'string' && !('mime_type' in result)) {
    result.mime_type = mimeType;
  }
  if (typeof name === 'string') {
    result.name = name;
  }
  if (metadata !== undefined && Object.keys(metadata).length > 0) {
    result.metadata = metadata;
  }
  return result as WirePart;
}

function withoutKey(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (record === undefined) {
    return undefined;
  }
  const {[key]: _dropped, ...rest} = record;
  return rest;
}
