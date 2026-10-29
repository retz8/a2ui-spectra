import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiLitElement} from '@a2ui/web_core/v0_9/universal';

import type {PageEvents} from './page.js';
import type {PreviewAction} from './protocol.js';
import {actionHandlerFor, guardUniversalElements, watchProcessor} from './web_core.js';

/** Every event a processor's surfaces reported, in order. */
function recordedEvents() {
  const actions: Array<[PreviewAction, unknown]> = [];
  const models: Array<[string, unknown]> = [];
  const errors: Array<{code: string; message: string; componentId?: string}> = [];
  const failures: Array<{componentId?: string; componentType?: string; error: unknown}> = [];
  const events: PageEvents = {
    action: (action, dataModel) => actions.push([action, dataModel]),
    dataModel: (surfaceId, dataModel) => models.push([surfaceId, dataModel]),
    surfaceError: error => errors.push(error),
    componentFailed: failure => failures.push(failure),
  };
  return {events, actions, models, errors, failures};
}

/** A processor with the v0.9 basic catalog, made and watched as an adapter does. */
function watchedProcessor() {
  const recorded = recordedEvents();
  const processor: MessageProcessor = new MessageProcessor(
    [basicCatalog],
    actionHandlerFor(recorded.events, () => processor),
  );
  const surfaces: string[] = [];
  const stop = watchProcessor(processor, recorded.events, surface => surfaces.push(surface.id));
  return {...recorded, processor, surfaces, stop};
}

/**
 * Feeds copies of messages, as each arrives over the wire: web core keeps an
 * `updateDataModel`'s value as its data model and changes it in place.
 */
function feed(processor: MessageProcessor, ...messages: unknown[]): void {
  processor.processMessages(
    structuredClone(messages) as Parameters<MessageProcessor['processMessages']>[0],
  );
}

const VERSION = 'v0.9';

const CREATE = {
  version: VERSION,
  createSurface: {surfaceId: 'greeting', catalogId: basicCatalog.id, sendDataModel: true},
};

const COMPONENTS = {
  version: VERSION,
  updateComponents: {
    surfaceId: 'greeting',
    components: [
      {id: 'root', component: 'Column', children: ['name', 'greet']},
      {id: 'name', component: 'TextField', label: 'Your name', value: {path: '/name'}},
      {
        id: 'greet',
        component: 'Button',
        child: 'greet_label',
        action: {event: {name: 'greet', context: {name: {path: '/name'}}}},
      },
      {id: 'greet_label', component: 'Text', text: 'Greet me'},
    ],
  },
};

const DATA = {
  version: VERSION,
  updateDataModel: {surfaceId: 'greeting', value: {name: 'Ada'}},
};

describe('watchProcessor', () => {
  it("reports each created surface's data model as it appears and on every change", () => {
    const {processor, models, surfaces} = watchedProcessor();
    feed(processor, CREATE);
    assert.deepEqual(surfaces, ['greeting']);
    assert.deepEqual(models, [['greeting', {}]]);
    feed(processor, COMPONENTS, DATA);
    assert.deepEqual(models.at(-1), ['greeting', {name: 'Ada'}]);
    processor.getSurface('greeting')!.dataModel.set('/name', 'Grace');
    assert.deepEqual(models.at(-1), ['greeting', {name: 'Grace'}]);
  });

  it('reports a copy of the data model, which later changes leave as it was', () => {
    const {processor, models} = watchedProcessor();
    feed(processor, CREATE, COMPONENTS, DATA);
    const reported = models.at(-1)![1];
    processor.getSurface('greeting')!.dataModel.set('/name', 'Grace');
    assert.deepEqual(reported, {name: 'Ada'});
  });

  it("reports an error web core sends on a surface's error channel, with its component when named", async () => {
    const {processor, errors} = watchedProcessor();
    feed(processor, CREATE);
    const surface = processor.getSurface('greeting')!;
    await surface.dispatchError({code: 'UNKNOWN_COMPONENT', message: 'No Chart in the catalog.'});
    await surface.dispatchError({
      code: 'RENDER_ERROR',
      message: 'The field failed.',
      componentId: 'name',
    } as Parameters<typeof surface.dispatchError>[0]);
    assert.deepEqual(errors, [
      {code: 'UNKNOWN_COMPONENT', message: 'No Chart in the catalog.'},
      {code: 'RENDER_ERROR', message: 'The field failed.', componentId: 'name'},
    ]);
  });

  it('stops reporting once stopped', () => {
    const {processor, models, surfaces, stop} = watchedProcessor();
    feed(processor, CREATE, COMPONENTS, DATA);
    const before = models.length;
    stop();
    processor.getSurface('greeting')!.dataModel.set('/name', 'Grace');
    feed(processor, {...CREATE, createSurface: {...CREATE.createSurface, surfaceId: 'other'}});
    assert.equal(models.length, before);
    assert.deepEqual(surfaces, ['greeting']);
  });
});

describe('actionHandlerFor', () => {
  it("reports an action with its surface's data model at that moment", async () => {
    const {processor, actions} = watchedProcessor();
    feed(processor, CREATE, COMPONENTS, DATA);
    const surface = processor.getSurface('greeting')!;
    surface.dataModel.set('/name', 'Grace');
    await surface.dispatchAction({event: {name: 'greet', context: {name: 'Grace'}}}, 'greet');
    assert.equal(actions.length, 1);
    const [action, dataModel] = actions[0];
    assert.equal(action.name, 'greet');
    assert.equal(action.surfaceId, 'greeting');
    assert.equal(action.sourceComponentId, 'greet');
    assert.deepEqual(action.context, {name: 'Grace'});
    assert.deepEqual(dataModel, {name: 'Grace'});
  });
});

describe('guardUniversalElements', () => {
  class Throwing extends A2uiLitElement<never> {
    protected override readonly api = undefined as never;
    override update(): void {
      throw new RangeError('Invalid time value');
    }
    /** One update, as Lit's scheduler runs it. */
    run(): void {
      this.performUpdate();
    }
  }

  /** An element whose update throws, knowing its component as the fields given say. */
  function throwing(known: Record<string, unknown>): Throwing {
    return Object.assign(new Throwing(), known);
  }

  it('reports a universal element that throws in its update, with the component it draws', () => {
    const {events, failures} = recordedEvents();
    guardUniversalElements(events.componentFailed);
    const element = throwing({node: {componentId: 'when', type: 'DateTimeInput'}});
    assert.doesNotThrow(() => element.run());
    assert.equal(failures.length, 1);
    assert.equal(failures[0].componentId, 'when');
    assert.equal(failures[0].componentType, 'DateTimeInput');
    assert.ok(failures[0].error instanceof RangeError);
  });

  it("names the component from the element's context when it has no node, reporting to the latest report", () => {
    const first = recordedEvents();
    const second = recordedEvents();
    guardUniversalElements(first.events.componentFailed);
    guardUniversalElements(second.events.componentFailed);
    throwing({context: {componentModel: {id: 'slider', type: 'CustomSlider'}}}).run();
    assert.equal(first.failures.length, 0);
    assert.deepEqual(
      second.failures.map(({componentId, componentType}) => ({componentId, componentType})),
      [{componentId: 'slider', componentType: 'CustomSlider'}],
    );
  });
});
