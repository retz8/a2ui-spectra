/**
 * Which of the four APIs a forwarded call is, on the providers' own hosts:
 * Gemini's `generateContent` and `streamGenerateContent?alt=sse`, OpenAI's
 * Chat Completions and Responses, and Anthropic's Messages. Any other call
 * is recorded raw.
 */
import {anthropicReader} from './anthropic.js';
import {GEMINI_PATH, geminiReader} from './gemini.js';
import {openAiChatReader} from './openai_chat.js';
import {openAiResponsesReader} from './openai_responses.js';
import type {ApiReader} from './reader.js';

export type {Api, ApiReader, ReadRequest, StreamChunk} from './reader.js';

const GEMINI_HOST = 'generativelanguage.googleapis.com';
const OPENAI_HOST = 'api.openai.com';
const ANTHROPIC_HOST = 'api.anthropic.com';

/** The hosts the four APIs are read on. */
export const PROVIDER_HOSTS: ReadonlySet<string> = new Set([
  GEMINI_HOST,
  OPENAI_HOST,
  ANTHROPIC_HOST,
]);

/**
 * The reader for a POST to a host and path, or nothing for a call recorded
 * raw. On the stand-in provider's origin the path alone names the API.
 */
export function readerFor(
  method: string,
  host: string,
  pathname: string,
  search: URLSearchParams,
  standIn: boolean,
): ApiReader | undefined {
  if (method !== 'POST') {
    return undefined;
  }
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  const gemini = GEMINI_PATH.exec(pathname);
  if (gemini !== null && (standIn || hostname === GEMINI_HOST)) {
    if (gemini[2] === 'streamGenerateContent' && search.get('alt') !== 'sse') {
      return undefined;
    }
    return geminiReader;
  }
  if (standIn || hostname === OPENAI_HOST) {
    if (pathname === '/v1/chat/completions') return openAiChatReader;
    if (pathname === '/v1/responses') return openAiResponsesReader;
  }
  if ((standIn || hostname === ANTHROPIC_HOST) && pathname === '/v1/messages') {
    return anthropicReader;
  }
  return undefined;
}
