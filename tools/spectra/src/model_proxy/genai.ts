/**
 * The GenAI names a model call read in full carries, in the shapes of the
 * copied schemas: messages with typed parts, tool definitions, and the
 * finish reasons of `gen-ai-output-messages.json`.
 */

/** The copied output-messages schema's finish reasons. */
export type FinishReason =
  'stop' | 'length' | 'content_filter' | 'tool_call' | 'compaction' | 'error';

export interface GenAiMessage {
  role: string;
  parts: GenAiPart[];
  finish_reason?: FinishReason;
}

/** A part in the copied schemas' shapes; a generic part is any other object with a `type`. */
export type GenAiPart = {type: string; [field: string]: unknown};

/** A stream's error: the provider's own type, and its message. */
export interface StreamError {
  type: string;
  message?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : undefined;
}

/** An object without its undefined values. */
export function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function textPart(content: string): GenAiPart {
  return {type: 'text', content};
}

export function reasoningPart(content: string): GenAiPart {
  return {type: 'reasoning', content};
}

export function toolCallPart(id: string | undefined, name: string, args: unknown): GenAiPart {
  return defined({type: 'tool_call', id, name, arguments: args});
}

export function toolCallResponsePart(id: string | undefined, response: unknown): GenAiPart {
  return defined({type: 'tool_call_response', id, response});
}

/** GenAI's modality for a media type: image, video, audio, else document. */
export function modalityOf(mimeType: string | undefined): string {
  const top = mimeType?.split('/')[0].trim().toLowerCase();
  return top === 'image' || top === 'video' || top === 'audio' ? top : 'document';
}

export function blobPart(mimeType: string | undefined, content: string): GenAiPart {
  return defined({type: 'blob', mime_type: mimeType, modality: modalityOf(mimeType), content});
}

export function uriPart(mimeType: string | undefined, uri: string): GenAiPart {
  return defined({type: 'uri', mime_type: mimeType, modality: modalityOf(mimeType), uri});
}

/** A tool call's arguments as the model wrote them: the parsed JSON of a string, else the value itself. */
export function parsedArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** The sum of the counts that are present; nothing when none is. */
export function sum(...counts: Array<number | undefined>): number | undefined {
  const present = counts.filter((count): count is number => count !== undefined);
  return present.length === 0 ? undefined : present.reduce((a, b) => a + b, 0);
}

/** A number of seconds from nanoseconds, to the millisecond. */
export function seconds(nanos: bigint): number {
  return Number(nanos / 1_000_000n) / 1000;
}
