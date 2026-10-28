import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  errorText,
  type ErrorSource,
  type PageEvents,
  type PreviewAdapter,
  type PreviewTransport,
  startPreviewPage,
} from './page.js';
import type {PageMessage, RenderMessage} from './protocol.js';

/** A processor that holds what it was fed, refusing a message marked so. */
interface FakeProcessor {
  id: number;
  fed: unknown[];
  events: PageEvents;
  disposed: boolean;
}

function fakeAdapter() {
  const processors: FakeProcessor[] = [];
  const mounted: Array<[number, string]> = [];
  const adapter: PreviewAdapter<FakeProcessor> = {
    createProcessor: events => {
      const processor = {id: processors.length + 1, fed: [], events, disposed: false};
      processors.push(processor);
      return processor;
    },
    feed: (processor, message) => {
      if ((message as {refuse?: string}).refuse !== undefined) {
        throw Object.assign(new Error((message as {refuse: string}).refuse), {
          name: 'A2uiValidationError',
          code: 'VALIDATION_ERROR',
        });
      }
      processor.fed.push(message);
    },
    mount: (processor, surfaceId) => mounted.push([processor.id, surfaceId]),
    teardown: processor => {
      processor.disposed = true;
    },
  };
  return {adapter, processors, mounted};
}

function fakeTransport() {
  const sent: PageMessage[] = [];
  let listener: ((message: unknown) => void) | undefined;
  const transport: PreviewTransport = {
    send: message => sent.push(structuredClone(message)),
    listen: onMessage => {
      listener = onMessage;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    transport,
    sent,
    deliver: (message: unknown) => listener?.(message),
  };
}

function fakeErrors() {
  let listener: ((error: unknown) => void) | undefined;
  const errors: ErrorSource = {
    listen: onError => {
      listener = onError;
      return () => {
        listener = undefined;
      };
    },
  };
  return {errors, raise: (error: unknown) => listener?.(error)};
}

const CATALOGS = [
  {id: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json', protocolVersion: '0.9'},
  {id: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json', protocolVersion: '1.0'},
];

const create = {version: 'v0.9', createSurface: {surfaceId: 'main', catalogId: CATALOGS[0].id}};
const update = {version: 'v0.9', updateComponents: {surfaceId: 'main', components: []}};
const data = {version: 'v0.9', updateDataModel: {surfaceId: 'main', value: {}}};

function render(number: number, messages: unknown[], surfaceId = 'main'): RenderMessage {
  return {type: 'a2ui-spectra-preview/render', render: number, surfaceId, messages};
}

function start() {
  const fake = fakeAdapter();
  const wire = fakeTransport();
  const window = fakeErrors();
  const page = startPreviewPage({
    catalogs: CATALOGS,
    adapter: fake.adapter,
    transport: wire.transport,
    errors: window.errors,
  });
  return {...fake, ...wire, ...window, page};
}

function reportsOf(sent: readonly PageMessage[]) {
  return sent.flatMap(message => (message.type === 'a2ui-spectra-preview/report' ? [message] : []));
}

describe('errorText', () => {
  it("reads an error's name and message, an error of another window's included", () => {
    assert.equal(errorText(new RangeError('Invalid time value')), 'RangeError: Invalid time value');
    assert.equal(
      errorText({name: 'RangeError', message: 'Invalid time value'}),
      'RangeError: Invalid time value',
    );
    assert.equal(errorText({message: 'no name'}), 'no name');
    assert.equal(errorText('a string'), 'a string');
  });
});

describe('startPreviewPage', () => {
  it('says it is ready with the protocol and the claims of its catalogs', () => {
    const {sent} = start();
    assert.deepEqual(sent, [
      {
        type: 'a2ui-spectra-preview/ready',
        protocol: 1,
        claims: [
          {catalogId: CATALOGS[0].id, protocolVersion: '0.9'},
          {catalogId: CATALOGS[1].id, protocolVersion: '1.0'},
        ],
      },
    ]);
  });

  it('feeds a first render into a new processor and mounts the surface', () => {
    const {deliver, processors, mounted} = start();
    deliver(render(1, [create, update]));
    assert.equal(processors.length, 1);
    assert.deepEqual(processors[0].fed, [create, update]);
    assert.deepEqual(mounted, [[1, 'main']]);
  });

  it('feeds only the tail of a list that extends the one applied', () => {
    const {deliver, processors} = start();
    deliver(render(1, [create, update]));
    deliver(render(2, [create, update, data]));
    assert.equal(processors.length, 1);
    assert.deepEqual(processors[0].fed, [create, update, data]);
  });

  it('recreates the processor for a shorter list, and for another surface', () => {
    const {deliver, processors} = start();
    deliver(render(1, [create, update, data]));
    deliver(render(2, [create]));
    assert.equal(processors.length, 2);
    assert.equal(processors[0].disposed, true);
    assert.deepEqual(processors[1].fed, [create]);
    deliver(render(3, [create], 'other'));
    assert.equal(processors.length, 3);
    assert.equal(processors[1].disposed, true);
  });

  it('reports a refused message with its index in the list, and feeds the rest', () => {
    const {deliver, sent, processors} = start();
    deliver(render(1, [create, {refuse: 'Invalid updateComponents message'}, data]));
    assert.deepEqual(processors[0].fed, [create, data]);
    assert.deepEqual(reportsOf(sent), [
      {
        type: 'a2ui-spectra-preview/report',
        render: 1,
        report: {
          kind: 'refused',
          index: 1,
          code: 'VALIDATION_ERROR',
          error: 'Invalid updateComponents message',
        },
      },
    ]);
  });

  it("tags each report with the render it belongs to, and sends the surface's earlier reports again with a render that extends it", () => {
    const {deliver, sent} = start();
    deliver(render(1, [create, {refuse: 'No'}]));
    deliver(render(2, [create, {refuse: 'No'}, data]));
    assert.deepEqual(
      reportsOf(sent).map(message => [message.render, message.report.kind]),
      [
        [1, 'refused'],
        [2, 'refused'],
      ],
    );
  });

  it("drops a recreated processor's earlier reports", () => {
    const {deliver, sent} = start();
    deliver(render(1, [create, {refuse: 'No'}]));
    deliver(render(2, [create]));
    assert.deepEqual(
      reportsOf(sent).map(message => message.render),
      [1],
    );
  });

  it("reports a component's failure and web core's error on the surface, each once", () => {
    const {deliver, sent, processors} = start();
    deliver(render(4, [create, update]));
    const {events} = processors[0];
    events.componentFailed({
      componentId: 'dateTimeInput_fbfcc3af',
      componentType: 'DateTimeInput',
      error: new RangeError('Invalid time value'),
    });
    events.componentFailed({
      componentId: 'dateTimeInput_fbfcc3af',
      componentType: 'DateTimeInput',
      error: new RangeError('Invalid time value'),
    });
    events.surfaceError({code: 'UNKNOWN_COMPONENT', message: "Unknown component type 'Map'"});
    assert.deepEqual(
      reportsOf(sent).map(message => message.report),
      [
        {
          kind: 'component',
          componentId: 'dateTimeInput_fbfcc3af',
          componentType: 'DateTimeInput',
          error: 'RangeError: Invalid time value',
        },
        {kind: 'surface', code: 'UNKNOWN_COMPONENT', error: "Unknown component type 'Map'"},
      ],
    );
    assert.ok(reportsOf(sent).every(message => message.render === 4));
  });

  it('reports an error the window saw as a component failure with no id, once a render has come', () => {
    const {deliver, sent, raise} = start();
    raise(new Error('before any render'));
    deliver(render(1, [create]));
    raise(new TypeError("Cannot read properties of undefined (reading 'x')"));
    assert.deepEqual(
      reportsOf(sent).map(message => message.report),
      [{kind: 'component', error: "TypeError: Cannot read properties of undefined (reading 'x')"}],
    );
  });

  it("drops what a disposed processor's surfaces report late", () => {
    const {deliver, sent, processors} = start();
    deliver(render(1, [create, update]));
    deliver(render(2, [create]));
    processors[0].events.componentFailed({componentId: 'late', error: new Error('late')});
    processors[0].events.action(
      {
        name: 'book',
        surfaceId: 'main',
        sourceComponentId: 'button',
        timestamp: '2026-10-28T09:00:00.000Z',
        context: {},
      },
      {},
    );
    assert.deepEqual(
      sent.filter(message => message.type !== 'a2ui-spectra-preview/ready'),
      [],
    );
  });

  it('sends an action with the data model at that moment, tagged with the current render', () => {
    const {deliver, sent, processors} = start();
    deliver(render(7, [create, update]));
    const action = {
      name: 'book_restaurant',
      surfaceId: 'main',
      sourceComponentId: 'book_button',
      timestamp: '2026-10-28T09:00:00.000Z',
      context: {restaurantName: "Xi'an Famous Foods"},
    };
    processors[0].events.action(action, {partySize: '2'});
    assert.deepEqual(sent[sent.length - 1], {
      type: 'a2ui-spectra-preview/action',
      render: 7,
      action,
      dataModel: {partySize: '2'},
    });
  });

  it('ignores what is not a render, and stops on stop', () => {
    const {deliver, processors, page} = start();
    deliver({type: 'a2ui-spectra-preview/render', render: 'one', surfaceId: 'main', messages: []});
    deliver({type: 'something else'});
    assert.equal(processors.length, 0);
    deliver(render(1, [create]));
    page.stop();
    assert.equal(processors[0].disposed, true);
    deliver(render(2, [create, update]));
    assert.equal(processors.length, 1);
  });
});
