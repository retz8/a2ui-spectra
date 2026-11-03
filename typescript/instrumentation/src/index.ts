/**
 * OpenTelemetry instrumentation of upstream's A2UI agent SDK, `@a2ui/agent`,
 * reporting the A2UI step to Spectra for A2UI.
 *
 * Switched on by launching the agent with
 * `node --import a2ui-spectra-instrumentation/register`, with one line before
 * the agent runs,
 *
 *     import {instrument} from 'a2ui-spectra-instrumentation';
 *     instrument();
 *
 * or as `new A2uiInstrumentation()` among an agent's own instrumentations.
 */

export {
  A2uiInstrumentation,
  instrument,
  type InstrumentOptions,
  uninstrument,
} from './instrumentation.js';
