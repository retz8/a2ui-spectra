// The facts a wrapper capture case's expected record states, read off `@a2ui/agent`.
//
// The TypeScript side of `wrapper_capture_facts.py`: runs one case's job, under
// conformance/wrapper_capture/, on `@a2ui/agent` as built in the `a2ui-upstream` worktree at the
// pin, upstream main `0888f88b2`, calling its public entry points as a driver does, and prints the
// same facts as JSON. Its basic catalogs are the worktree's catalog files. It shares no code with
// Spectra. From the repository root, after `yarn build` in the worktree's
// `typescript/agents/a2ui_agent`:
//
//     node _dev/tools/wrapper_capture_facts.mjs ../a2ui-upstream \
//         conformance/test_data/wrapper_capture/v0_1/<case>/input.json
//
// An error belongs to the block that was being compiled, or whose messages were being applied,
// when it was raised, and its range is where that block's text, as the SDK's parser unwraps it,
// sits in the input. An error raised after every block, by the tree check or by the validation
// of a whole payload, belongs to no block.

import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [upstream, jobPath] = process.argv.slice(2);
const agentDir = path.resolve(upstream, 'typescript/agents/a2ui_agent');
const sdk = await import(path.join(agentDir, 'dist/src/index.js'));
const sdkVersion = JSON.parse(readFileSync(path.join(agentDir, 'package.json'), 'utf8')).version;
const conformance = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../conformance');

const FACTORIES = {
  direct_json: sdk.DirectJsonFormatFactory,
  express: sdk.ExpressFormatFactory,
};
const BASIC = {
  'v0.9': ['specification/v0_9/catalogs/basic/catalog.json', 'v0.9'],
  'v0.9.1': ['specification/v0_9_1/catalogs/basic/catalog.json', 'v0.9.1'],
  'v1.0': ['catalogs/basic/v1/catalog.json', '1.0'],
};
// The functions that check every block at once, after each block is applied.
const AFTER_EVERY_BLOCK = /\bat (?:\S+\.)?(?:checkTopology|validatePayload) /;

const job = JSON.parse(readFileSync(jobPath, 'utf8'));
const caseDir = path.dirname(jobPath);
const text = job.text === undefined ? undefined : readFileSync(path.join(caseDir, job.text), 'utf8');

async function catalogsOf() {
  const catalogs = [];
  for (const catalog of job.catalogs) {
    if (catalog.path !== undefined) {
      const version = catalog.protocolVersion;
      catalogs.push(
        await new sdk.FileSystemCatalogProvider(path.join(conformance, catalog.path), version).load(),
      );
    } else {
      const [file, version] = BASIC[catalog.protocolVersion];
      catalogs.push(
        await new sdk.FileSystemCatalogProvider(
          path.join(upstream, file),
          version,
          catalog.catalogId,
        ).load(),
      );
    }
  }
  return catalogs;
}

async function processorOf() {
  return new sdk.A2uiRequestProcessor(
    await catalogsOf(),
    undefined,
    new FACTORIES[job.inferenceFormat](),
  );
}

/** A UTF-16 offset is a JavaScript string index. */
function blocksOf(processor, input, wrapped) {
  if (!wrapped) return [[0, input.length]];
  const ranges = [];
  let cursor = 0;
  for (const raw of processor.parser.unwrap(input)) {
    if (raw.type !== 'a2ui') continue;
    const start = input.indexOf(raw.a2uiRaw, cursor);
    if (start < 0) throw new Error(`A block's text is not in the input: ${raw.a2uiRaw.slice(0, 60)}`);
    cursor = start + raw.a2uiRaw.length;
    ranges.push([start, cursor]);
  }
  return ranges;
}

const TAGS = {direct_json: '<a2ui-json>', express: '<a2ui>'};

/** Each block's range, a block whose closing tag never came running to the end of the text. */
function openBlocks(processor, input, wrapped) {
  if (!wrapped) return [[0, input.length]];
  const closed = blocksOf(processor, input, wrapped);
  const tag = TAGS[job.inferenceFormat];
  const openings = [];
  for (let at = input.indexOf(tag); at >= 0; at = input.indexOf(tag, at + tag.length)) {
    openings.push(at + tag.length);
  }
  if (openings.length > closed.length) closed.push([openings[closed.length], input.length]);
  return closed;
}

function errorFact(error, block) {
  // The SDK's structured details: a details array whose every item is an object.
  const structured =
    Array.isArray(error.details) &&
    error.details.every(detail => typeof detail === 'object' && detail !== null);
  const details = structured ? error.details.map(detail => ({...detail})) : [];
  const afterEveryBlock = AFTER_EVERY_BLOCK.test(error.stack ?? '');
  return {
    type: error.constructor.name,
    message: error.message,
    ...(details.length > 0 && {details}),
    ...(block !== undefined && block !== null && !afterEveryBlock && {block}),
  };
}

function messagesOf(parts) {
  return parts.filter(part => part.type === 'a2ui').flatMap(part => structuredClone(part.a2ui));
}

function isA2uiError(error) {
  return error instanceof sdk.A2uiError || error?.constructor?.name?.endsWith('Error');
}

async function generate() {
  const processor = await processorOf();
  try {
    return {section: processor.promptSnippet};
  } catch (error) {
    if (!isA2uiError(error)) throw error;
    return {errors: [errorFact(error, undefined)]};
  }
}

async function parseResponse() {
  const processor = await processorOf();
  const wrapped = job.wrapped ?? true;
  try {
    const parts = processor.parseResponse(text, {wrapped});
    return {messages: messagesOf(parts), errors: []};
  } catch (error) {
    if (!isA2uiError(error)) throw error;
    const partial = error.partialResults ?? [];
    const failing = partial.filter(part => part.type === 'a2ui').length;
    const blocks = blocksOf(processor, text, wrapped);
    return {messages: messagesOf(partial), errors: [errorFact(error, blocks[failing])]};
  }
}

/** Feeds the chunks in order, stopping at the first that throws, and closes the stream unless one did. */
async function openStream() {
  const processor = await processorOf();
  const wrapped = job.wrapped ?? true;
  const ends = JSON.parse(readFileSync(path.join(caseDir, job.chunks), 'utf8'));
  const stream = processor.openStream({
    wrapped,
    afterRejectedBlock: job.afterRejectedBlock ?? 'end',
  });
  const messages = [];
  const raised = [];
  let fed = 0;
  const take = (parts, chunk) => {
    for (const part of parts) {
      if (part.type === 'a2ui') messages.push(...structuredClone(part.a2ui));
      else if (part.type === 'error') raised.push([part.error, chunk]);
    }
  };
  const facts = async closed => {
    const blocks = await streamErrorBlocks(wrapped);
    if (blocks.length !== raised.length) {
      throw new Error(
        `Fed one character at a time, the stream raised ${blocks.length} errors, not ${raised.length}`,
      );
    }
    const errors = raised.map(([error, chunk], index) => ({...errorFact(error, blocks[index]), chunk}));
    return {messages, errors, fed, closed};
  };
  let start = 0;
  for (const end of ends) {
    fed++;
    try {
      take(stream.feed(text.slice(start, end)), fed - 1);
    } catch (error) {
      if (!isA2uiError(error)) throw error;
      take(error.partialResults ?? [], fed - 1);
      raised.push([error, fed - 1]);
      return facts(false);
    }
    start = end;
  }
  try {
    take(stream.close(), null);
  } catch (error) {
    if (!isA2uiError(error)) throw error;
    take(error.partialResults ?? [], null);
    raised.push([error, null]);
  }
  return facts(true);
}

/**
 * The block of each error the stream throws or reads past, in order. The text
 * is fed one character at a time: when an error comes, the text fed ends inside
 * the block it belongs to, or at that block's closing tag, so the block is the
 * last one opened by then.
 */
async function streamErrorBlocks(wrapped) {
  const processor = await processorOf();
  const stream = processor.openStream({
    wrapped,
    afterRejectedBlock: job.afterRejectedBlock ?? 'end',
  });
  const blocks = openBlocks(processor, text, wrapped);
  const blockAt = position => blocks.filter(block => block[0] <= position).at(-1);
  const found = [];
  const errorsIn = (parts, position) => {
    for (const part of parts) if (part.type === 'error') found.push(blockAt(position));
  };
  let position = 0;
  for (const character of text) {
    position += character.length;
    try {
      errorsIn(stream.feed(character), position);
    } catch (error) {
      if (!isA2uiError(error)) throw error;
      return [...found, blockAt(position)];
    }
  }
  try {
    errorsIn(stream.close(), position);
  } catch (error) {
    if (!isA2uiError(error)) throw error;
    return [...found, blockAt(position)];
  }
  return found;
}

async function compileBlock() {
  const processor = await processorOf();
  try {
    return {messages: structuredClone(processor.parser.compile(text)), errors: []};
  } catch (error) {
    if (!isA2uiError(error)) throw error;
    return {messages: [], errors: [errorFact(error, [0, text.length])]};
  }
}

const run = {
  generate,
  parse_response: parseResponse,
  open_stream: openStream,
  compile: compileBlock,
}[job.entryPoint];
const facts = await run();
facts.sdk = {name: '@a2ui/agent', version: sdkVersion};
console.log(JSON.stringify(facts));
