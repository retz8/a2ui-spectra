import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {parse, promptGeneration} from '../testing/a2ui_step.ts';
import {
  a2uiDelivery,
  at,
  byStart,
  linked,
  modelCall,
  receivedSpan,
  TRACE,
} from '../testing/model_calls.ts';
import {heldCatalogs, readTestData} from '../testing/recordings.ts';
import {
  a2uiStepErrorsOf,
  formatNameOf,
  generationProblemOf,
  parseOfComponent,
  parseOfMessage,
  parseProblemsOf,
  parseTitleOf,
  rangesSentenceOf,
  readByLinesOf,
  readByOf,
  readFromOf,
  readerCatalogOf,
  retriedByOf,
  retriesOf,
  retryCountOf,
  retrySentenceOf,
  sdkOf,
  sourceLineOfStep,
  stepHeaderPartsOf,
  uiSectionsOf,
} from './a2ui_step.ts';
import {type Step, timelineOf} from './steps.ts';
import {insideLineOf} from './turn_calls.ts';
import type {KnownCatalog} from './catalogs.ts';
import {agentMessages} from './messages.ts';
import {
  isModelCall,
  isParse,
  type ModelCallEvent,
  type ParseEvent,
  type Turn,
  type TurnRecordEvent,
  unixMillis,
} from './record.ts';

function turnOf(file: string, at = -1): Turn {
  const {turns} = readTestData(file);
  return turns[at < 0 ? turns.length + at : at];
}

/** A reply's text, as a model call's output message. */
function reply(text: string): Record<string, unknown> {
  return {'gen_ai.output.messages': [{role: 'assistant', parts: [{type: 'text', content: text}]}]};
}

const BAD =
  '<a2ui-json>\n[{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"c"}},' +
  '{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"c"}}]\n</a2ui-json>';
const GOOD =
  '<a2ui-json>\n[{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"c","components":[' +
  '{"id":"root","component":"Text","text":"hi"}]}}]\n</a2ui-json>';
const GOOD_MESSAGES = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 's',
      catalogId: 'c',
      components: [{id: 'root', component: 'Text', text: 'hi'}],
    },
  },
];
const FAILED = {
  type: 'A2uiIntegrityError',
  message: 'Surface s already exists.',
  block: [12, 170] as [number, number],
  ms: 1018,
};

/** A turn whose first reply fails to parse and is retried, then retried again. */
function retriedTwice(): TurnRecordEvent[] {
  return byStart(
    modelCall({spanId: 'call-a', start: 0, end: 1000, attributes: reply(BAD)}),
    parse({spanId: 'parse-1', start: 1010, end: 1020, input: BAD, errors: [FAILED]}),
    modelCall({spanId: 'call-b', start: 1050, end: 2000, attributes: reply(BAD)}),
    parse({spanId: 'parse-2', start: 2010, end: 2020, input: BAD, errors: [{...FAILED, ms: 2018}]}),
    modelCall({spanId: 'call-c', start: 2050, end: 3000, attributes: reply(GOOD)}),
    parse({spanId: 'parse-3', start: 3010, end: 3020, input: GOOD, messages: GOOD_MESSAGES}),
  );
}

describe('the retry', () => {
  it('counts the first model call after each failed parse as its retry, along the chain', () => {
    const retries = retriesOf(retriedTwice());
    assert.deepEqual(
      [...retries].map(([id, retry]) => `${id}: retry ${retry.attempt} of ${retry.parseSpanId}`),
      ['call-b: retry 1 of parse-1', 'call-c: retry 2 of parse-2'],
    );
    assert.equal(retries.get('call-b')?.stated, false);
  });

  it('lets a stated retry win, with the parse its link names', () => {
    const events = retriedTwice().map(event =>
      event.spanId === 'call-b'
        ? linked(
            {
              ...event,
              attributes: {...event.attributes, 'a2ui.retry.attempt': 4},
            } as TurnRecordEvent,
            'parse-1',
          )
        : event,
    );
    const retry = retriesOf(events).get('call-b');
    assert.deepEqual(retry, {attempt: 4, parseSpanId: 'parse-1', stated: true});
  });

  it('reads a stated retry on a received span, the receiver suite’s stated_retry case', () => {
    const turn = turnOf('receiver_capture/v0_1/stated_retry/expected.json');
    const retries = retriesOf(turn.events);
    assert.deepEqual(
      [...retries.values()],
      [{attempt: 1, parseSpanId: '4d5e6f708192a3b4', stated: true}],
    );
  });

  it('infers the retry on the retried-parse record, and takes the stated one on the restaurant finder’s', () => {
    const inferred = retriesOf(turnOf('turn_record/v0_1/full_record_retried_parse.json').events);
    assert.deepEqual(
      [...inferred],
      [['f1c7d4b28e5a3906', {attempt: 1, parseSpanId: 'e9f3a6c15b8d2704', stated: false}]],
    );
    const stated = retriesOf(
      turnOf('turn_record/v0_1/full_record_restaurant_finder.json', 1).events,
    );
    assert.deepEqual(
      [...stated],
      [['c998da45a75c258d', {attempt: 2, parseSpanId: '4e2863ab2ba26543', stated: true}]],
    );
  });

  it('counts no retry after a parse that succeeded', () => {
    const events = byStart(
      modelCall({spanId: 'call-a', start: 0, end: 1000, attributes: reply(GOOD)}),
      parse({spanId: 'parse-1', start: 1010, input: GOOD, messages: GOOD_MESSAGES}),
      modelCall({spanId: 'call-b', start: 1050, end: 2000}),
    );
    assert.equal(retriesOf(events).size, 0);
  });
});

describe('the model call a parse read', () => {
  it('ties a parse to the call whose reply holds its input', () => {
    const readBy = readByOf(retriedTwice());
    assert.deepEqual(
      [...readBy],
      [
        ['parse-1', 'call-a'],
        ['parse-2', 'call-b'],
        ['parse-3', 'call-c'],
      ],
    );
  });

  it('ties a parse to the call whose tool-call argument holds its input', () => {
    const events = byStart(
      modelCall({
        spanId: 'call-a',
        start: 0,
        end: 1000,
        attributes: {
          'gen_ai.output.messages': [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'send_a2ui_json_to_client',
                  arguments: {a2ui_payload: GOOD},
                },
              ],
            },
          ],
        },
      }),
      parse({
        spanId: 'parse-1',
        start: 1010,
        input: GOOD,
        entryPoint: 'tool_call',
        tool: {name: 'send_a2ui_json_to_client', callId: 'c1'},
      }),
    );
    assert.deepEqual([...readByOf(events)], [['parse-1', 'call-a']]);
    // Read from a tool call's argument, the parse names the call's tool call, not its reply.
    const read = events.find(event => event.spanId === 'parse-1') as ParseEvent;
    assert.match(
      readFromOf(events, read, unixMillis(at(0))).text,
      /^The tool call of .+ at \+0 ms$/,
    );
  });

  it('ties a stream opened before its call to the call whose reply holds its input, over an earlier call whose argument its input holds', () => {
    // As the Python restaurant finder runs: the stream opens before the call it reads.
    const text = `Here are the top 3 Chinese restaurants in New York:\n\n${GOOD}`;
    const events = byStart(
      modelCall({
        spanId: 'call-a',
        start: 0,
        end: 1000,
        attributes: {
          'gen_ai.output.messages': [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'get_restaurants',
                  arguments: {location: 'New York', cuisine: 'Chinese', count: 3},
                },
                {type: 'text', content: ''},
              ],
            },
          ],
        },
      }),
      parse({spanId: 'parse-1', start: 1099, end: 2001, input: text, messages: GOOD_MESSAGES}),
      modelCall({spanId: 'call-b', start: 1100, end: 2000, attributes: reply(text)}),
    );
    assert.deepEqual([...readByOf(events)], [['parse-1', 'call-b']]);
  });

  it('ties a stream fed its call’s reply twice to that call, the one accounting for the most of its input', () => {
    // The restaurant finder feeds a stream ADK's partial chunks, then the aggregated copy: A2UI finding 31.
    const text = `Here are the top 3 Chinese restaurants in New York:\n\n${GOOD}`;
    const events = byStart(
      modelCall({
        spanId: 'call-a',
        start: 0,
        end: 1000,
        attributes: {
          'gen_ai.output.messages': [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool_call',
                  id: 'c1',
                  name: 'get_restaurants',
                  arguments: {location: 'New York', cuisine: 'Chinese', count: 3},
                },
              ],
            },
          ],
        },
      }),
      parse({spanId: 'parse-1', start: 1099, end: 2001, input: text + text, errors: [FAILED]}),
      modelCall({spanId: 'call-b', start: 1100, end: 2000, attributes: reply(text)}),
    );
    assert.deepEqual([...readByOf(events)], [['parse-1', 'call-b']]);
  });

  it('ties a parse by time to the latest call started before it when the calls carry no text', () => {
    const events = byStart(
      receivedSpan({spanId: 'span-a', name: 'call_llm', start: 0, end: 1000}),
      receivedSpan({spanId: 'span-b', name: 'call_llm', start: 1050, end: 2000}),
      parse({spanId: 'parse-1', start: 2010, input: GOOD}),
    );
    assert.deepEqual([...readByOf(events)], [['parse-1', 'span-b']]);
  });

  it('leaves a parse unlinked when no call started before it, or two started at once', () => {
    const none = byStart(
      parse({spanId: 'parse-1', start: 10, input: GOOD}),
      receivedSpan({spanId: 'span-a', name: 'call_llm', start: 100, end: 1000}),
    );
    assert.equal(readByOf(none).size, 0);
    const tie = byStart(
      receivedSpan({spanId: 'span-a', name: 'call_llm', start: 0, end: 1000}),
      receivedSpan({spanId: 'span-b', name: 'call_llm', start: 0, end: 900}),
      parse({spanId: 'parse-1', start: 2010, input: GOOD}),
    );
    assert.equal(readByOf(tie).size, 0);
  });

  it('ties the retried-parse record’s parses to their calls', () => {
    const readBy = readByOf(turnOf('turn_record/v0_1/full_record_retried_parse.json').events);
    assert.deepEqual(
      [...readBy],
      [
        ['e9f3a6c15b8d2704', 'd2b5e8a17c4f9603'],
        ['a5e1b8d36f2c4807', 'f1c7d4b28e5a3906'],
      ],
    );
  });
});

describe('the parse a component came from', () => {
  const {events} = turnOf('turn_record/v0_1/full_record_retried_parse.json');

  it('traces a wire message to the latest earlier parse holding an equal message', () => {
    const [message] = agentMessages(events);
    assert.equal(parseOfMessage(events, message.key)?.spanId, 'a5e1b8d36f2c4807');
  });

  it('gives a tree component its range in that parse', () => {
    const traced = parseOfComponent(events, 'restaurant-card-surface', 'bookButton');
    assert.equal(traced?.parse.spanId, 'a5e1b8d36f2c4807');
    const text = traced!.parse.attributes['a2ui.parse.input'].slice(
      traced!.range!.start,
      traced!.range!.end,
    );
    assert.match(text, /^\{\s*"id": "bookButton"/);
  });

  it('falls back to the latest earlier parse holding the component by surface and id', () => {
    const own = byStart(
      parse({spanId: 'parse-1', start: 10, input: GOOD, messages: GOOD_MESSAGES}),
      a2uiDelivery('delivery', 100),
    );
    // The delivery's message is not among the parse's, but the parse holds surface s's root.
    const message = agentMessages(own)[0];
    assert.equal(parseOfMessage(own, message.key), undefined);
    assert.equal(parseOfComponent(own, 's', 'root')?.parse.spanId, 'parse-1');
    assert.equal(parseOfComponent(own, 's', 'missing'), undefined);
  });
});

describe('the UI section in the request', () => {
  const {events} = turnOf('turn_record/v0_1/full_record_retried_parse.json');
  const calls = events.filter(isModelCall);

  it('finds the section inside each call’s system prompt, once', () => {
    for (const call of calls) {
      const sections = uiSectionsOf(events, call);
      assert.equal(sections.length, 1);
      const [section] = sections;
      assert.equal(section.segment, 0);
      assert.equal(section.generation.spanId, 'c4a8f1e26d3b7905');
      const system = (call.attributes['gen_ai.system_instructions'] as Array<{content: string}>)[0]
        .content;
      assert.equal(
        system.slice(section.start, section.end),
        section.generation.attributes['a2ui.prompt.ui_section'],
      );
    }
  });

  it('marks every occurrence, and nothing in a call that holds none', () => {
    const generation = promptGeneration({spanId: 'gen', start: 0, section: 'UI RULES'});
    const twice = modelCall({
      spanId: 'call',
      start: 10,
      end: 20,
      system: 'UI RULES and UI RULES again',
      messages: [{role: 'user', text: 'hi'}],
    });
    assert.deepEqual(
      uiSectionsOf([generation, twice], twice).map(s => [s.segment, s.start, s.end]),
      [
        [0, 0, 8],
        [0, 13, 21],
      ],
    );
    const none = modelCall({spanId: 'call', start: 10, end: 20, system: 'Just prose'});
    assert.deepEqual(uiSectionsOf([generation, none], none), []);
  });
});

describe('parse errors as problems', () => {
  it('reads the error that ended a parse as "stopped on this block", with its range', () => {
    const [problem] = parseProblemsOf(parse({spanId: 'p', start: 0, input: BAD, errors: [FAILED]}));
    assert.deepEqual(problem, {
      sentence: 'The parse stopped on this block: Surface s already exists.',
      code: 'A2uiIntegrityError · A2UI SDK, Python',
      range: {start: 12, end: 170},
    });
  });

  it('reads a block a stream read past as "rejected this block and read on"', () => {
    const streamed = parse({
      spanId: 'p',
      start: 0,
      input: BAD + GOOD,
      chunks: [
        {ms: 2, end: 100},
        {ms: 6, end: 300},
      ],
      errors: [
        {
          type: 'ExpressValidationError',
          message: "Function 'Heading' is not defined.",
          block: [12, 90],
          ms: 4,
        },
      ],
      sdk: '@a2ui/agent',
    });
    assert.deepEqual(parseProblemsOf(streamed), [
      {
        sentence: "The stream rejected this block and read on: Function 'Heading' is not defined.",
        code: 'ExpressValidationError · A2UI SDK, TypeScript',
        range: {start: 12, end: 90},
      },
    ]);
  });

  it('reads a failed parse that states no exception as one problem', () => {
    const terse = parse({spanId: 'p', start: 0, input: BAD});
    terse.status = {code: 2, message: 'Bad UI.'};
    terse.attributes['error.type'] = 'AgentError';
    assert.deepEqual(parseProblemsOf(terse), [
      {sentence: 'The parse failed: Bad UI.', code: 'AgentError · A2UI SDK, Python'},
    ]);
  });

  it('reads a failed prompt generation as one problem', () => {
    const failed = promptGeneration({
      spanId: 'g',
      start: 0,
      failure: {
        type: 'A2uiCatalogError',
        message: 'Catalog example.com:contacts declares no components.',
      },
    });
    assert.deepEqual(generationProblemOf(failed), {
      sentence:
        "The SDK could not write the prompt's UI section: Catalog example.com:contacts declares no components.",
      code: 'A2uiCatalogError · A2UI SDK, Python',
    });
    assert.equal(generationProblemOf(promptGeneration({spanId: 'g', start: 0})), undefined);
  });

  it('counts the A2UI step’s errors: each exception event, a terse failed parse, a failed generation', () => {
    assert.equal(
      a2uiStepErrorsOf(turnOf('turn_record/v0_1/full_record_retried_parse.json').events),
      1,
    );
    assert.equal(
      a2uiStepErrorsOf(turnOf('turn_record/v0_1/full_record_restaurant_finder.json', 1).events),
      1,
    );
    const two = parse({spanId: 'p', start: 0, input: BAD, errors: [FAILED, {...FAILED, ms: 1019}]});
    const failed = promptGeneration({spanId: 'g', start: 0, failure: {type: 'E', message: 'm'}});
    assert.equal(a2uiStepErrorsOf([two, failed]), 3);
  });
});

describe('the header’s format and catalog', () => {
  it('names the formats and catalogs the turn’s events used, each once, in order of first use', () => {
    const events = byStart(
      promptGeneration({spanId: 'g', start: 0, format: 'express'}),
      parse({spanId: 'p1', start: 10, input: GOOD, format: 'express'}),
      parse({spanId: 'p2', start: 20, input: GOOD, format: 'direct_json'}),
    );
    assert.deepEqual(stepHeaderPartsOf(events), ['Express', 'Direct JSON', 'basic, v1.0']);
    assert.deepEqual(stepHeaderPartsOf([a2uiDelivery('d', 0)]), []);
  });

  it('names a custom catalog by its title and protocol version', () => {
    const events = [
      promptGeneration({
        spanId: 'g',
        start: 0,
        catalogs: [
          {catalogId: 'https://example.com/contacts/catalog.json', protocolVersion: 'v1.0'},
        ],
      }),
    ];
    const catalogs: KnownCatalog[] = [
      {
        id: 'https://example.com/contacts/catalog.json',
        title: 'Contacts',
        aliases: [],
        protocolVersion: '1.0',
        source: 'configured',
        definition: {},
      },
    ];
    assert.deepEqual(stepHeaderPartsOf(events, catalogs), ['Direct JSON', 'Contacts v1.0']);
  });

  it('names formats and SDKs', () => {
    assert.equal(formatNameOf('direct_json'), 'Direct JSON');
    assert.equal(formatNameOf('elemental'), 'Elemental');
    assert.equal(sdkOf(parse({spanId: 'p', start: 0, input: ''})), 'A2UI SDK, Python');
    assert.equal(
      sdkOf(parse({spanId: 'p', start: 0, input: '', sdk: '@a2ui/agent'})),
      'A2UI SDK, TypeScript',
    );
    const bare = parse({spanId: 'p', start: 0, input: ''});
    delete bare.attributes['a2ui.sdk.name'];
    assert.equal(sdkOf(bare), 'A2UI SDK');
  });
});

// Keeps the imports the type checks use.
void isParse;
void at;
void TRACE;
void (null as unknown as ModelCallEvent);

describe('what the A2UI step says in the detail', () => {
  const {events} = turnOf('turn_record/v0_1/full_record_retried_parse.json');
  const startMs = Number(BigInt(events[0].startTimeUnixNano) / 1_000_000n);
  const parses = events.filter(isParse);
  const [failedParse, goodParse] = parses;

  it('counts the retries for the header’s second line, after the model calls', () => {
    assert.equal(retryCountOf(events), 1);
    assert.equal(retryCountOf(retriedTwice()), 2);
    const line = insideLineOf(events, startMs, undefined)!;
    assert.deepEqual(line.slice(2, 4), ['2 model calls', '1 retry']);
    assert.ok(insideLineOf(retriedTwice(), startMs, undefined)!.includes('2 retries'));
  });

  it('titles a parse with its format, streamed, and its scope, or "A2UI step spans" without one', () => {
    const step = timelineOf(events, startMs).find(
      (row): row is Step => row.row === 'step' && row.parse?.spanId === failedParse.spanId,
    )!;
    assert.deepEqual(parseTitleOf(step, startMs), {
      target: 'Direct JSON · streamed · a2ui-spectra-instrumentation 0.1.0',
      times: '+2.0 s · 20 ms',
    });
    assert.equal(sourceLineOfStep(failedParse), 'a2ui-spectra-instrumentation 0.1.0');
    const bare = parse({spanId: 'p', start: 0, input: ''});
    delete bare.attributes['otel.scope.name'];
    delete bare.attributes['otel.scope.version'];
    assert.equal(sourceLineOfStep(bare), 'A2UI step spans');
  });

  it('names the model call a parse read, as a link, or that it is tied to none', () => {
    assert.deepEqual(readFromOf(events, failedParse, startMs), {
      text: 'The reply of gemini-3.6-flash at +20 ms',
      stepId: 'd2b5e8a17c4f9603',
    });
    assert.deepEqual(readFromOf([failedParse], failedParse, startMs), {
      text: 'Tied to no model call',
    });
  });

  it('lists the parses that read a model call, each a link', () => {
    assert.deepEqual(readByLinesOf(events, 'f1c7d4b28e5a3906', startMs), [
      {text: 'Read by the parse at +5.0 s · Direct JSON', parseSpanId: goodParse.spanId},
    ]);
    assert.deepEqual(readByLinesOf(events, 'nobody', startMs), []);
  });

  it('says why a model call is a retry, the failed parse a link, and names the retry on the parse', () => {
    const retry = retriesOf(events).get('f1c7d4b28e5a3906')!;
    assert.deepEqual(retrySentenceOf(events, retry, startMs), {
      lead: 'Retry 1 · the reply of the call at +20 ms',
      link: {text: 'failed to parse', parseSpanId: failedParse.spanId},
      tail: 'Surface default already exists.',
    });
    assert.deepEqual(retriedByOf(events, failedParse, startMs), {
      text: 'Retried by the call at +2.0 s',
      stepId: 'f1c7d4b28e5a3906',
    });
    assert.equal(retriedByOf(events, goodParse, startMs), undefined);
    assert.deepEqual(retrySentenceOf(events, {attempt: 3, stated: true}, startMs), {
      lead: 'Retry 3',
    });
  });

  it('says why there are no ranges, or where the reader stopped', () => {
    assert.equal(
      rangesSentenceOf({ranges: [{surfaceId: 's', componentId: 'c', start: 0, end: 1}]}, 'express'),
      undefined,
    );
    assert.equal(
      rangesSentenceOf(undefined, undefined),
      'No component ranges · the parse names no inference format',
    );
    assert.equal(
      rangesSentenceOf({ranges: [], stoppedAt: 3}, 'express'),
      'No component ranges · the Express reader could not read this text',
    );
    assert.equal(
      rangesSentenceOf(
        {ranges: [{surfaceId: 's', componentId: 'c', start: 0, end: 1}], stoppedAt: 1204},
        'express',
      ),
      'Component ranges up to character 1,204 · the Express reader stopped there',
    );
  });

  describe('what the readers know of a parse’s catalogs', () => {
    const held = heldCatalogs();
    const V09 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
    const V091 = 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';
    const V10 = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
    const parseOn = (...ids: string[]) => ({
      'a2ui.parse.catalogs': ids.map(catalogId => ({catalogId, protocolVersion: 'v1.0'})),
    });

    it('reads a catalog matched by its id with that definition alone', () => {
      // The viewer holds v0.9's basic catalog before v1.0's; a v1.0 parse gets v1.0's TextField.
      assert.equal(held[0].id, V09);
      const v10 = readerCatalogOf(held, parseOn(V10));
      assert.deepEqual(v10.propertyOrder('TextField'), [
        'label',
        'value',
        'placeholder',
        'variant',
        'weight',
      ]);
      assert.equal(v10.isContainer('Card'), true);
      assert.equal(v10.wrapsBareStrings('Column'), true);
      // Every named catalog is held: a name none of them defines is no component.
      assert.equal(v10.isComponent('Chart'), false);
    });

    it('reads a catalog matched by an alias with the definition it names', () => {
      const v091 = readerCatalogOf(held, parseOn(V091));
      assert.deepEqual(v091.propertyOrder('TextField'), [
        'label',
        'value',
        'variant',
        'validationRegexp',
        'weight',
      ]);
    });

    it('reads a name no held catalog defines by the no-catalog rule when a named catalog is not held', () => {
      const partial = readerCatalogOf(held, parseOn(V10, 'https://example.com/not-held.json'));
      assert.equal(partial.isComponent('Chart'), true);
      assert.equal(partial.propertyOrder('Chart'), undefined);
      assert.equal(partial.isContainer('Chart'), undefined);
      assert.equal(partial.isComponent('Event'), false);
      assert.deepEqual(partial.propertyOrder('Card'), ['child', 'weight']);
    });

    it('reads a parse that names no catalog by the no-catalog rule throughout', () => {
      for (const attributes of [{}, {'a2ui.parse.catalogs': []}]) {
        const none = readerCatalogOf(held, attributes);
        assert.equal(none.isComponent('Card'), true);
        assert.equal(none.isComponent('_template'), false);
        assert.equal(none.propertyOrder('Card'), undefined);
        assert.equal(none.wrapsBareStrings('Column'), undefined);
      }
      assert.equal(readerCatalogOf(undefined, parseOn(V10)).propertyOrder('Card'), undefined);
    });

    it('lets a call’s catalog id pick the definition, else the first named catalog that defines the name', () => {
      const two = readerCatalogOf(held, parseOn(V10, 'spectra/readers'));
      assert.deepEqual(two.propertyOrder('Card'), ['child', 'weight']);
      assert.deepEqual(two.propertyOrder('Card', 'spectra/readers'), ['footer', 'child']);
      assert.equal(two.isComponent('Leaf', V10), false);
      assert.equal(two.isComponent('Leaf'), true);
    });

    it('follows the SDK the parse names where the two compilers disagree, Python’s when it names none', () => {
      const readers = parseOn('spectra/readers');
      assert.equal(readerCatalogOf(held, readers).sdk, 'python');
      assert.deepEqual(readerCatalogOf(held, readers).propertyOrder('Shelf'), ['body', 'head']);
      const typescript = readerCatalogOf(held, {...readers, 'a2ui.sdk.name': '@a2ui/agent'});
      assert.equal(typescript.sdk, 'typescript');
      assert.deepEqual(typescript.propertyOrder('Shelf'), ['head', 'body']);
    });
  });
});
