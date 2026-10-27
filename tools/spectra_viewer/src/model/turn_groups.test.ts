import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {briefText, type GroupedTurn, groupTurns, searchGroups, stripOf} from './turn_groups.ts';

const turn = (traceId: string, fields: Partial<GroupedTurn> = {}): GroupedTurn => ({
  traceId,
  startTime: '2026-10-24T09:00:00.000Z',
  ...fields,
});

const listing: GroupedTurn[] = [
  turn('cd2559ab0000', {
    conversationId: '35afb6d5',
    agentName: 'Restaurant Agent',
    outcome: 'waiting_for_input',
    input: {text: 'Book a table for 2'},
  }),
  turn('776aef460000', {
    conversationId: '0e8f6531',
    agentName: 'FileUpload Summarizer Agent',
    outcome: 'completed',
    input: {text: 'Show me the file uploader again'},
    rejections: 1,
  }),
  turn('09b758f00000', {
    conversationId: '35afb6d5',
    agentName: 'Restaurant Agent',
    outcome: 'waiting_for_input',
    input: {text: 'Top 3 Italian restaurants'},
    findings: 1,
  }),
  turn('193e24d50000', {outcome: 'failed', input: {action: 'next'}}),
];

describe('groupTurns', () => {
  it("groups by conversation in the order of each one's newest turn, titled by its first message", () => {
    const groups = groupTurns(listing);
    assert.deepEqual(
      groups.map(group => ({
        key: group.key,
        title: briefText(group.title),
        agent: group.agentName,
        turns: group.turns.map(t => t.traceId),
        problems: group.problems,
      })),
      [
        {
          key: '35afb6d5',
          title: 'Top 3 Italian restaurants',
          agent: 'Restaurant Agent',
          turns: ['cd2559ab0000', '09b758f00000'],
          problems: 1,
        },
        {
          key: '0e8f6531',
          title: 'Show me the file uploader again',
          agent: 'FileUpload Summarizer Agent',
          turns: ['776aef460000'],
          problems: 1,
        },
        {
          key: '193e24d50000',
          title: 'Action “next”',
          agent: undefined,
          turns: ['193e24d50000'],
          problems: 1,
        },
      ],
    );
  });
});

describe('searchGroups', () => {
  const groups = groupTurns(listing);
  const found = (query: string) =>
    searchGroups(groups, query).map(
      group => `${group.key}: ${group.turns.map(t => t.traceId).join(' ')}`,
    );

  it("keeps only a group's matching turns", () => {
    assert.deepEqual(found('book'), ['35afb6d5: cd2559ab0000']);
  });

  it('matches every turn of a group by its title or agent', () => {
    assert.deepEqual(found('italian'), ['35afb6d5: cd2559ab0000 09b758f00000']);
    assert.deepEqual(found('fileupload'), ['0e8f6531: 776aef460000']);
  });

  it('matches a trace or conversation id by its start', () => {
    assert.deepEqual(found('776aef46'), ['0e8f6531: 776aef460000']);
    assert.deepEqual(found('35AFB6D5'), ['35afb6d5: cd2559ab0000 09b758f00000']);
  });

  it('keeps everything for an empty search', () => {
    assert.equal(searchGroups(groups, '  ').length, 3);
  });
});

describe('stripOf', () => {
  it("lists every turn in the turn list's order, each titled by its input and its problems", () => {
    assert.deepEqual(
      stripOf(groupTurns(listing)).map(({turn, problems, title}) => ({
        traceId: turn.traceId,
        problems,
        title,
      })),
      [
        {traceId: 'cd2559ab0000', problems: 0, title: 'Book a table for 2'},
        {traceId: '09b758f00000', problems: 1, title: 'Top 3 Italian restaurants · 1 problem'},
        {
          traceId: '776aef460000',
          problems: 1,
          title: 'Show me the file uploader again · 1 problem',
        },
        {traceId: '193e24d50000', problems: 1, title: 'Action “next” · 1 problem'},
      ],
    );
  });
});
