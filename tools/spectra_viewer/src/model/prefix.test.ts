import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {modelCall, rawCall} from '../testing/model_calls.ts';
import {candidatesFor, partName, prefixBreakOf, segmentsOf} from './prefix.ts';

const HEAD = 'You are a helpful contact lookup assistant.\n\n';
const TAIL = '\n\nButtons that represent the main action SHOULD include "variant": "primary".';
const tools = [{name: 'get_contact_info', description: 'Gets a contact.'}];

/** The custom-components example's first call of a turn: its system prompt, its tool and the question. */
function first(
  spanId: string,
  start: number,
  prompt = `${HEAD}Current time: 2026-10-30T14:02:31Z${TAIL}`,
) {
  return modelCall({
    spanId,
    start,
    end: start + 2000,
    system: prompt,
    tools,
    messages: [{role: 'user', text: 'Find the contact card for Alex Jordan'}],
  });
}

/** The same turn's second call: the first call's request with the tool call and its result after it. */
function second(spanId: string, start: number, prompt?: string) {
  const earlier = first(spanId, start, prompt);
  return modelCall({
    spanId,
    start,
    end: start + 2000,
    system: (earlier.attributes['gen_ai.system_instructions'] as Array<{content: string}>)[0]
      .content,
    tools,
    messages: [
      {role: 'user', text: 'Find the contact card for Alex Jordan'},
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            id: 'toolu_1',
            name: 'get_contact_info',
            arguments: {name: 'Alex Jordan'},
          },
        ],
      },
      {role: 'user', parts: [{type: 'tool_call_response', id: 'toolu_1', response: {result: []}}]},
    ],
  });
}

const turn = (traceId: string, ...calls: ReturnType<typeof modelCall>[]) => ({traceId, calls});

describe('segmentsOf', () => {
  it('reads a request in cache order: each tool definition, the system prompt, then each message', () => {
    const segments = segmentsOf(second('b'.repeat(16), 3000));
    assert.deepEqual(
      segments.map(segment => [segment.part, segment.role ?? '']),
      [
        ['tools', ''],
        ['system', ''],
        ['message', 'user'],
        ['message', 'assistant'],
        ['message', 'user'],
      ],
    );
    assert.equal(segments[2].text, 'Find the contact card for Alex Jordan');
    // A tool call is its JSON block, as the readable request shows it.
    assert.match(segments[3].text, /^\{\n {2}"type": "tool_call",/);
  });
});

describe('prefixBreakOf', () => {
  it('reads "First … call in this conversation" with no earlier call of the model', () => {
    const call = first('a'.repeat(16), 0);
    assert.deepEqual(prefixBreakOf(call, []), {form: 'first', model: 'claude-sonnet-5-5'});
    // A call of another model is no candidate.
    const other = modelCall({
      spanId: 'c'.repeat(16),
      start: -5000,
      end: -4000,
      model: 'claude-haiku-5-5',
    });
    assert.deepEqual(candidatesFor(call, [turn('t', other, call)]), []);
  });

  it('reads "Shares all of the earlier call\'s request" when the earlier call\'s whole request is a prefix of this one', () => {
    const one = first('a'.repeat(16), 0);
    const two = second('b'.repeat(16), 3000);
    const found = prefixBreakOf(two, candidatesFor(two, [turn('t1', one, two)]));
    assert.equal(found?.form, 'shares_earlier');
    assert.ok(found?.form === 'shares_earlier');
    assert.equal(found.earlier.call.spanId, 'a'.repeat(16));
    assert.equal(found.earlier.traceId, 't1');
  });

  it('reads "Shares all of its request with the call at …" when every segment of this call is in the earlier one', () => {
    const longer = second('a'.repeat(16), 0);
    const shorter = first('b'.repeat(16), 9000);
    const found = prefixBreakOf(
      shorter,
      candidatesFor(shorter, [turn('t1', longer), turn('t2', shorter)]),
    );
    assert.equal(found?.form, 'shares_this');
  });

  it('reads "Prefix breaks in the system prompt · against the call at …", the marker at the changed character', () => {
    const earlier = second('a'.repeat(16), 0);
    const changed = first('b'.repeat(16), 9000, `${HEAD}Current time: 2026-10-30T14:02:33Z${TAIL}`);
    const found = prefixBreakOf(
      changed,
      candidatesFor(changed, [turn('t1', earlier), turn('t2', changed)]),
    );
    assert.ok(found?.form === 'breaks');
    assert.equal(found.part, 'system');
    assert.equal(partName(found), 'the system prompt');
    assert.equal(found.earlier.traceId, 't1');
    assert.deepEqual(found.marker, {
      segment: 1,
      before: HEAD,
      earlier: ['Current time: 2026-10-30T14:02:3', '1', 'Z'],
      current: ['Current time: 2026-10-30T14:02:3', '3', 'Z'],
      after: TAIL.replace(/^\n/, ''),
    });
  });

  it('names a break in the tool definitions, and one in the nth message', () => {
    const earlier = second('a'.repeat(16), 0);
    const renamed = modelCall({
      ...{spanId: 'b'.repeat(16), start: 9000, end: 9500},
      system: 'x',
      tools: [{name: 'get_contact_info', description: 'Gets one contact.'}],
    });
    const inTools = prefixBreakOf(renamed, candidatesFor(renamed, [turn('t', earlier, renamed)]));
    assert.ok(inTools?.form === 'breaks');
    assert.equal(partName(inTools), 'the tool definitions');

    const asked = second('c'.repeat(16), 9000);
    (
      asked.attributes['gen_ai.input.messages'] as Array<{parts: Array<{content?: string}>}>
    )[0].parts[0].content = 'Find the contact card for Casey Smith';
    const inMessage = prefixBreakOf(asked, candidatesFor(asked, [turn('t', earlier, asked)]));
    assert.ok(inMessage?.form === 'breaks');
    assert.equal(inMessage.message, 1);
    assert.equal(partName(inMessage), 'message 1');
    assert.deepEqual(inMessage.marker.earlier, ['Find the contact card for ', 'Alex Jordan', '']);
    assert.deepEqual(inMessage.marker.current, ['Find the contact card for ', 'Casey Smith', '']);
  });

  it('reads a last message that this call carries on, as LiteLLM adds the next question to it, as shared whole', () => {
    const earlier = first('a'.repeat(16), 0);
    const next = modelCall({
      spanId: 'b'.repeat(16),
      start: 9000,
      end: 9500,
      system: (earlier.attributes['gen_ai.system_instructions'] as Array<{content: string}>)[0]
        .content,
      tools,
      messages: [
        {
          role: 'user',
          parts: [
            {type: 'text', content: 'Find the contact card for Alex Jordan'},
            {type: 'text', content: 'What is their email address?'},
          ],
        },
      ],
    });
    assert.equal(
      prefixBreakOf(next, candidatesFor(next, [turn('t', earlier, next)]))?.form,
      'shares_earlier',
    );
    // The other way round, every part of the shorter request is in the earlier one.
    const shorter = first('c'.repeat(16), 20_000);
    assert.equal(
      prefixBreakOf(shorter, candidatesFor(shorter, [turn('t', next), turn('u', shorter)]))?.form,
      'shares_this',
    );
  });

  it('shows the next line as the differing span when a message goes on where the other went on to another', () => {
    const earlier = modelCall({
      spanId: 'a'.repeat(16),
      start: 0,
      end: 1,
      messages: [
        {role: 'user', text: 'Retry: Who is Alex Jordan?'},
        {role: 'assistant', text: 'x'},
      ],
    });
    const next = modelCall({
      spanId: 'b'.repeat(16),
      start: 2,
      end: 3,
      messages: [
        {
          role: 'user',
          parts: [
            {type: 'text', content: 'Retry: Who is Alex Jordan?'},
            {type: 'text', content: 'And Casey?'},
          ],
        },
      ],
    });
    const found = prefixBreakOf(next, candidatesFor(next, [turn('t', earlier, next)]));
    assert.ok(found?.form === 'breaks');
    assert.equal(partName(found), 'message 1');
    assert.deepEqual(found.marker.current, ['Retry: Who is Alex Jordan?', '\n\nAnd Casey?', '']);
    assert.deepEqual(found.marker.earlier, ['Retry: Who is Alex Jordan?', '', '']);
  });

  it('compares with the call sharing the longest prefix, the latest on a tie, and never with one recorded raw', () => {
    const one = first('a'.repeat(16), 0);
    const two = second('b'.repeat(16), 3000);
    const again = second('c'.repeat(16), 6000);
    const three = second('d'.repeat(16), 9000);
    // `two` and `again` share all of `three`'s request; the later wins.
    const found = prefixBreakOf(three, candidatesFor(three, [turn('t', one, two, again, three)]));
    assert.ok(found?.form === 'shares_earlier');
    assert.equal(found.earlier.call.spanId, 'c'.repeat(16));
    // A call that started after this one is no candidate.
    assert.ok(candidatesFor(one, [turn('t', one, two)]).length === 0);
    // A call recorded raw has no prefix break and is no candidate.
    const raw = rawCall('e'.repeat(16), 1000, 2000);
    assert.equal(prefixBreakOf(raw, []), undefined);
    assert.deepEqual(
      candidatesFor(two, [turn('t', raw, one, two)]).map(c => c.call.spanId),
      ['a'.repeat(16)],
    );
  });

  it('knows the request at the call’s start, so a call in flight has its sentence', () => {
    const one = first('a'.repeat(16), 0);
    const inFlight = modelCall({...{spanId: 'b'.repeat(16), start: 3000}, system: 'other', tools});
    assert.equal(inFlight.endTimeUnixNano, undefined);
    assert.equal(
      prefixBreakOf(inFlight, candidatesFor(inFlight, [turn('t', one, inFlight)]))?.form,
      'breaks',
    );
  });
});
