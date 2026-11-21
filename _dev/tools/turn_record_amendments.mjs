/**
 * The edits that turn record v0.1's amendments of sub-task 10.8 make to the
 * committed test data under `conformance/test_data/`, and the check that the
 * test data's whole diff is those edits and nothing else. From the
 * repository root, after `yarn build:all`, since it reads the model proxy's
 * readers from the tool's build:
 *
 *     node _dev/tools/turn_record_amendments.mjs apply
 *     node _dev/tools/turn_record_amendments.mjs check [<base commit>]
 *
 * `apply` writes the edits into every file they change, the wrapper capture
 * suite's expected records left to their harness,
 * `_dev/tools/write_wrapper_capture_records.py`. `check` applies the edits to
 * every file as the base commit holds it, `HEAD` by default, and requires
 * the working tree's file to equal the result, by JSON value for a JSON file
 * and byte for byte for any other; it names each file that differs, is new
 * or is gone, and exits 1 when any does. A wrapper capture record may also
 * state another `a2ui.sdk.version`, which its harness reads off the agent SDK
 * and the suite's comparison skips; the check counts those apart.
 *
 * The edits:
 * - the capture path `wrapper` is `a2ui_step`;
 * - `a2ui.replay.source` has forward slashes;
 * - a wire message's data part that is not A2UI has the type `a2ui.data`;
 * - a proxy's tool call for an operation the server initiated has span kind 2;
 * - `rpc.response.status_code` is `rpc.status_code`;
 * - a proxy's model call read in full has `gen_ai.response.time_to_first_chunk`
 *   from its first chunk that carries output, and a call recorded raw has none;
 * - a span of the A2UI step, as sent and as received, carries
 *   `a2ui.record.version`, `v0.1`, after its `a2ui.event.kind`.
 */
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = 'conformance/test_data';
const WRAPPER_CAPTURE = `${DATA}/wrapper_capture/`;
const STEP_KINDS = new Set(['prompt_generation', 'parse']);
const RECORD_VERSION = 'v0.1';

const readers = await import(
  path.join(ROOT, 'tools/spectra/dist/model_proxy/readers/output_chunks.js')
);
const {seconds} = await import(path.join(ROOT, 'tools/spectra/dist/model_proxy/genai.js'));

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An object with one key renamed or one inserted after another, every other key in its place. */
function withKeys(object, entries) {
  return Object.fromEntries(entries(Object.entries(object)));
}

function renamed(object, from, to) {
  return withKeys(object, entries => entries.map(([key, value]) => [key === from ? to : key, value]));
}

function insertedAfter(object, after, key, value) {
  return withKeys(object, entries =>
    entries.flatMap(entry => (entry[0] === after ? [entry, [key, value]] : [entry])),
  );
}

/** Whether a chunk carries output, by the reader of the call's API. */
function carriesOutputFor(attributes) {
  const provider = attributes['gen_ai.provider.name'];
  const url = String(attributes['url.full'] ?? '');
  if (provider === 'gcp.gemini') return readers.geminiCarriesOutput;
  if (provider === 'anthropic') return readers.anthropicCarriesOutput;
  if (provider === 'openai') {
    return /\/responses(\?|$)/.test(url)
      ? readers.openAiResponsesCarriesOutput
      : readers.openAiChatCarriesOutput;
  }
  return undefined;
}

function amendedAttributes(event) {
  let attributes = event.attributes;
  const kind = attributes['a2ui.event.kind'];
  const received = attributes['a2ui.received.attributes'];
  if (kind === 'turn') {
    const paths = attributes['a2ui.turn.capture_paths'];
    if (Array.isArray(paths)) {
      attributes = {
        ...attributes,
        'a2ui.turn.capture_paths': paths.map(name => (name === 'wrapper' ? 'a2ui_step' : name)),
      };
    }
    const source = attributes['a2ui.replay.source'];
    if (typeof source === 'string') {
      attributes = {...attributes, 'a2ui.replay.source': source.replaceAll('\\', '/')};
    }
  }
  if (kind === 'wire_input' || kind === 'wire_output') {
    const message = attributes['a2ui.wire.message'];
    if (isObject(message) && Array.isArray(message.parts)) {
      attributes = {
        ...attributes,
        'a2ui.wire.message': {
          ...message,
          parts: message.parts.map(part =>
            isObject(part) && part.type === 'data' ? {...part, type: 'a2ui.data'} : part,
          ),
        },
      };
    }
  }
  if (kind === 'tool_call' && 'rpc.response.status_code' in attributes) {
    attributes = renamed(attributes, 'rpc.response.status_code', 'rpc.status_code');
  }
  if (
    kind === 'model_call' &&
    received === undefined &&
    'gen_ai.response.time_to_first_chunk' in attributes
  ) {
    const carries = 'gen_ai.operation.name' in attributes ? carriesOutputFor(attributes) : undefined;
    const first = (event.events ?? []).find(
      spanEvent =>
        spanEvent.name === 'a2ui.http.response.chunk' &&
        carries?.({
          ...(spanEvent.attributes?.['a2ui.http.response.chunk.event'] !== undefined && {
            event: spanEvent.attributes['a2ui.http.response.chunk.event'],
          }),
          data: spanEvent.attributes?.['a2ui.http.response.chunk.body'],
        }) === true,
    );
    if (first === undefined) {
      const {'gen_ai.response.time_to_first_chunk': _dropped, ...rest} = attributes;
      attributes = rest;
    } else {
      attributes = {
        ...attributes,
        'gen_ai.response.time_to_first_chunk': seconds(
          BigInt(first.timeUnixNano) - BigInt(event.startTimeUnixNano),
        ),
      };
    }
  }
  if (
    isObject(received) &&
    STEP_KINDS.has(received['a2ui.event.kind']) &&
    !('a2ui.record.version' in received)
  ) {
    attributes = {
      ...attributes,
      'a2ui.received.attributes': insertedAfter(
        received,
        'a2ui.event.kind',
        'a2ui.record.version',
        RECORD_VERSION,
      ),
    };
  }
  return attributes;
}

function amendedEvent(event) {
  if (!isObject(event) || !isObject(event.attributes)) return event;
  const attributes = amendedAttributes(event);
  const serverInitiated =
    attributes['a2ui.event.kind'] === 'tool_call' &&
    attributes['a2ui.received.attributes'] === undefined &&
    event.kind === 4;
  return {...event, ...(serverInitiated && {kind: 2}), attributes};
}

/** A turn record with the edits; any other value as it is. */
function amendedRecord(value) {
  if (!isObject(value) || !Array.isArray(value.turns)) return value;
  return {
    ...value,
    turns: value.turns.map(turn =>
      isObject(turn) && Array.isArray(turn.events)
        ? {...turn, events: turn.events.map(amendedEvent)}
        : turn,
    ),
  };
}

/** An OTLP/JSON attribute list with the record version after a step span's kind. */
function amendedSpanAttributes(attributes) {
  if (!Array.isArray(attributes)) return attributes;
  const kind = attributes.find(attribute => attribute?.key === 'a2ui.event.kind');
  if (!STEP_KINDS.has(kind?.value?.stringValue)) return attributes;
  if (attributes.some(attribute => attribute?.key === 'a2ui.record.version')) return attributes;
  return attributes.flatMap(attribute =>
    attribute === kind
      ? [attribute, {key: 'a2ui.record.version', value: {stringValue: RECORD_VERSION}}]
      : [attribute],
  );
}

/** A receiver capture case's exports with the edits; any other value as it is. */
function amendedExports(value) {
  if (!Array.isArray(value)) return value;
  return value.map(request => {
    const spans = request?.body?.resourceSpans;
    if (!Array.isArray(spans)) return request;
    return {
      ...request,
      body: {
        ...request.body,
        resourceSpans: spans.map(resource => ({
          ...resource,
          scopeSpans: (resource.scopeSpans ?? []).map(scope => ({
            ...scope,
            spans: (scope.spans ?? []).map(span => ({
              ...span,
              attributes: amendedSpanAttributes(span.attributes),
            })),
          })),
        })),
      },
    };
  });
}

function amended(value) {
  return amendedExports(amendedRecord(value));
}

function filesUnder(dir) {
  return readdirSync(path.join(ROOT, dir), {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory()
      ? filesUnder(`${dir}/${entry.name}`)
      : entry.isFile()
        ? [`${dir}/${entry.name}`]
        : [],
  );
}

function parsed(text) {
  try {
    return {ok: true, value: JSON.parse(text)};
  } catch {
    return {ok: false};
  }
}

function apply() {
  let written = 0;
  for (const file of filesUnder(DATA)) {
    if (!file.endsWith('.json') || file.startsWith(WRAPPER_CAPTURE)) continue;
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const read = parsed(text);
    if (!read.ok) continue;
    const next = amended(read.value);
    if (JSON.stringify(next) === JSON.stringify(read.value)) continue;
    if (`${JSON.stringify(read.value, null, 2)}\n` !== text) {
      throw new Error(`${file} changes and is not written as JSON.stringify writes it.`);
    }
    writeFileSync(path.join(ROOT, file), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`amended ${file}`);
    written++;
  }
  console.log(`${written} files amended.`);
}

/** A wrapper capture record without its step events' `a2ui.sdk.version`, sent and received. */
function withoutSdkVersion(value) {
  if (!isObject(value) || !Array.isArray(value.turns)) return value;
  return {
    ...value,
    turns: value.turns.map(turn => ({
      ...turn,
      events: turn.events.map(event => {
        const {'a2ui.sdk.version': _sent, ...attributes} = event.attributes;
        const received = attributes['a2ui.received.attributes'];
        if (isObject(received)) {
          const {'a2ui.sdk.version': _received, ...rest} = received;
          attributes['a2ui.received.attributes'] = rest;
        }
        return {...event, attributes};
      }),
    })),
  };
}

function check(base) {
  const git = args => execFileSync('git', args, {cwd: ROOT, maxBuffer: 1 << 30});
  const before = git(['ls-tree', '-r', '--name-only', base, '--', DATA])
    .toString()
    .split('\n')
    .filter(Boolean);
  const after = filesUnder(DATA);
  const problems = [];
  for (const file of after.filter(file => !before.includes(file))) problems.push(`new: ${file}`);
  for (const file of before.filter(file => !after.includes(file))) problems.push(`gone: ${file}`);
  let changed = 0;
  let sdkVersions = 0;
  for (const file of before.filter(file => after.includes(file))) {
    const old = git(['show', `${base}:${file}`]);
    const now = readFileSync(path.join(ROOT, file));
    if (!old.equals(now)) changed++;
    const oldRead = parsed(old.toString('utf8'));
    const nowRead = parsed(now.toString('utf8'));
    if (file.endsWith('.json') && oldRead.ok && nowRead.ok) {
      const expected = JSON.stringify(amended(oldRead.value));
      const actual = JSON.stringify(nowRead.value);
      if (expected === actual) continue;
      if (
        file.startsWith(WRAPPER_CAPTURE) &&
        JSON.stringify(withoutSdkVersion(JSON.parse(expected))) ===
          JSON.stringify(withoutSdkVersion(nowRead.value))
      ) {
        sdkVersions++;
      } else {
        problems.push(`differs from the amendments' edits: ${file}`);
      }
    } else if (!old.equals(now)) {
      problems.push(`changed, not as JSON: ${file}`);
    }
  }
  for (const problem of problems) console.log(problem);
  console.log(
    `${before.length} files at ${base}, ${changed} changed: ${
      problems.length === 0
        ? "the test data's whole diff is the amendments' edits"
        : `${problems.length} not the amendments' edits`
    }; ${sdkVersions} wrapper capture records also state the agent SDK version their harness read.`,
  );
  return problems.length === 0 ? 0 : 1;
}

const [mode, base = 'HEAD'] = process.argv.slice(2);
if (mode === 'apply') apply();
else if (mode === 'check') process.exitCode = check(base);
else {
  console.error('Usage: node _dev/tools/turn_record_amendments.mjs apply | check [<base commit>]');
  process.exitCode = 2;
}
