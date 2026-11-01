// The facts a wrapper capture case's expected record states, read off `@a2ui/agent`.
//
// The TypeScript side of `wrapper_capture_facts.py`: runs one case's job, under
// conformance/wrapper_capture/, on `@a2ui/agent` as built in the `a2ui-upstream` worktree at
// upstream main `825beac28`, calling its public entry points as a driver does, and prints the
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
  const details = Array.isArray(error.details) ? error.details.map(detail => ({...detail})) : [];
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
  const blocks = openBlocks(processor, text, wrapped);
  const blockAt = position => blocks.filter(block => block[0] <= position).at(-1);
  const messages = [];
  const errors = [];
  let fed = 0;
  const take = (parts, position, chunk) => {
    for (const part of parts) {
      if (part.type === 'a2ui') messages.push(...structuredClone(part.a2ui));
      else if (part.type === 'error') {
        errors.push({...errorFact(part.error, blockAt(position)), chunk});
      }
    }
  };
  let start = 0;
  for (const end of ends) {
    fed++;
    try {
      take(stream.feed(text.slice(start, end)), end, fed - 1);
    } catch (error) {
      if (!isA2uiError(error)) throw error;
      take(error.partialResults ?? [], end, fed - 1);
      errors.push({...errorFact(error, blockAt(end)), chunk: fed - 1});
      return {messages, errors, fed, closed: false};
    }
    start = end;
  }
  try {
    take(stream.close(), text.length, null);
  } catch (error) {
    if (!isA2uiError(error)) throw error;
    take(error.partialResults ?? [], text.length, null);
    errors.push({...errorFact(error, blockAt(text.length)), chunk: null});
  }
  return {messages, errors, fed, closed: true};
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
