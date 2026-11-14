import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {jsonLines, lineMarksOf, markedLine, markedPath, unfoldedTo} from './json_lines.ts';
import {isWireOutput} from './record.ts';

const message = {
  version: 'v0.9',
  createSurface: {surfaceId: 's1', catalogId: 'basic'},
  list: [1, 2],
  none: {},
};

describe('jsonLines', () => {
  it('shows JSON as JSON.stringify indents it, each object and array foldable', () => {
    const lines = jsonLines(message);
    assert.deepEqual(
      lines.map(line => line.text),
      JSON.stringify(message, null, 2).split('\n'),
    );
    assert.deepEqual(
      lines.filter(line => line.fold !== undefined).map(line => line.fold),
      ['', '/createSurface', '/list'],
    );
  });

  it('shows a folded object or array as one line counting what it holds', () => {
    const lines = jsonLines(message, new Set(['/createSurface', '/list']));
    assert.deepEqual(
      lines.map(line => line.text),
      [
        '{',
        '  "version": "v0.9",',
        '  "createSurface": { … 2 keys },',
        '  "list": [ … 2 items ],',
        '  "none": {}',
        '}',
      ],
    );
    assert.equal(lines[2].folded, true);
  });

  it('escapes a key in its path as a JSON Pointer does', () => {
    const lines = jsonLines({'a/b': {'c~d': 1}});
    assert.equal(lines[1].fold, '/a~1b');
    assert.equal(lines[2].path, '/a~1b/c~0d');
  });
});

describe('markedPath', () => {
  it("is the pointer's own value when the JSON holds it", () => {
    assert.equal(markedPath(message, '/createSurface/catalogId'), '/createSurface/catalogId');
    assert.equal(markedPath(message, '/list/1'), '/list/1');
    assert.equal(markedPath(message, ''), '');
  });

  it('is the deepest value on the way to a property the JSON lacks', () => {
    assert.equal(markedPath(message, '/createSurface/theme'), '/createSurface');
    assert.equal(markedPath(message, '/list/5/name'), '/list');
    assert.equal(markedPath(message, '/missing/deeper'), '');
  });

  it('reads an escaped key as a JSON Pointer does', () => {
    assert.equal(markedPath({'a/b': {'c~d': 1}}, '/a~1b/c~0d'), '/a~1b/c~0d');
  });
});

describe('markedLine', () => {
  it("is a value's own line, and an object's or array's opening line", () => {
    const lines = jsonLines(message);
    assert.equal(
      lines[markedLine(lines, '/createSurface/catalogId')].text,
      '    "catalogId": "basic"',
    );
    assert.equal(lines[markedLine(lines, '/createSurface')].text, '  "createSurface": {');
    assert.equal(lines[markedLine(lines, '')].text, '{');
  });

  it('is the folded line that hides it, until what hides it is unfolded', () => {
    const folded = new Set(['/createSurface']);
    const lines = jsonLines(message, folded);
    assert.equal(
      lines[markedLine(lines, '/createSurface/catalogId')].text,
      '  "createSurface": { … 2 keys },',
    );
    const unfolded = unfoldedTo(folded, '/createSurface/catalogId');
    assert.deepEqual([...unfolded], []);
    const open = jsonLines(message, unfolded);
    assert.equal(
      open[markedLine(open, '/createSurface/catalogId')].text,
      '    "catalogId": "basic"',
    );
  });

  it('leaves a folded object that hides no marked path folded', () => {
    assert.deepEqual(
      [...unfoldedTo(new Set(['/list', '/createSurface']), '/createSurface/surfaceId')],
      ['/list'],
    );
  });

  it("marks the flawed booking's Button property and its updateDataModel's opening line", () => {
    const delivery = readRecording('stub_agent/flawed_booking_a2a_1_0').turns[0].events.find(
      isWireOutput,
    );
    assert.ok(delivery);
    const parts = delivery.attributes['a2ui.wire.message'].parts;
    const components = parts[2].content;
    const componentLines = jsonLines(components);
    const colour = markedPath(components, '/updateComponents/components/3/colour');
    assert.equal(
      componentLines[markedLine(componentLines, colour)].text,
      '        "colour": "primary"',
    );
    const dataModel = parts[5].content;
    const dataModelLines = jsonLines(dataModel);
    const surface = markedPath(dataModel, '/updateDataModel/surfaceId');
    assert.equal(
      dataModelLines[markedLine(dataModelLines, surface)].text,
      '  "updateDataModel": {',
    );
  });
});

describe('lineMarksOf', () => {
  const components = {
    updateComponents: {
      surfaceId: 'booking',
      components: [
        {id: 'name', component: 'TextField', checks: [{message: 'Needed.'}], label: 'Name'},
        {id: 'time', component: 'ChoicePicker', checks: [], '@checks': [], label: 'Time'},
        {id: 'submit', component: 'Button', accessibility: {label: 'Book'}, child: 'l'},
      ],
    },
  };
  const at = (index: number, key: string) => `/updateComponents/components/${index}/${key}`;
  const legacy = [at(0, 'checks'), at(2, 'accessibility')];
  const marked = (lines: ReturnType<typeof jsonLines>, marks: string[]) =>
    lineMarksOf(lines, marks, legacy)
      .map((mark, index) => ({...mark, text: lines[index].text.trim()}))
      .filter(mark => mark.marked || mark.legacy);

  it('bands the line holding a bare key, and keeps the hourglass on one a finding’s pointer ends at, in soft red', () => {
    const lines = jsonLines(components);
    assert.deepEqual(marked(lines, [at(0, 'checks'), at(1, 'checks')]), [
      {marked: true, legacy: true, text: '"checks": ['},
      // The rejected component carrying both forms: soft red, no hourglass.
      {marked: true, legacy: false, text: '"checks": [],'},
      {marked: false, legacy: true, text: '"accessibility": {'},
    ]);
  });

  it('carries the band of a bare key on the folded line that hides it', () => {
    const lines = jsonLines(
      components,
      new Set(['/updateComponents/components/0', '/updateComponents/components/2']),
    );
    assert.deepEqual(marked(lines, []), [
      {marked: false, legacy: true, text: '{ … 4 keys },'},
      {marked: false, legacy: true, text: '{ … 4 keys }'},
    ]);
  });
});
