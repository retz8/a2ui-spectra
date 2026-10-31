/**
 * A reader for one of the four APIs the model proxy reads in full: the
 * request's and the response's GenAI names, from the bodies as sent.
 */
import type {StreamError} from '../genai.js';

export type Api = 'gemini' | 'openai_chat_completions' | 'openai_responses' | 'anthropic_messages';

/** One server-sent event of a streamed response, its data parsed when JSON. */
export interface StreamChunk {
  event?: string;
  data: unknown;
}

export interface ReadRequest {
  /** The path under the provider's host. */
  pathname: string;
  search: URLSearchParams;
  /** The body as JSON, when it was. */
  body: unknown;
}

export interface ApiReader {
  readonly api: Api;
  /** The request's names: the operation, the provider, the model, the settings, the system prompt, the messages and the tools. */
  request(request: ReadRequest): Record<string, unknown>;
  /** The response's names from a body that was not streamed. */
  response(body: unknown): Record<string, unknown>;
  /** The response's names from the chunks of a stream, and the error the stream carried, if one. */
  stream(chunks: StreamChunk[]): {attributes: Record<string, unknown>; error?: StreamError};
  /** The provider's error message in a reply of 400 or above. */
  errorMessage(body: unknown): string | undefined;
}
