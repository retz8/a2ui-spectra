/** `A2uiInstrumentation`, the wrapper as an OpenTelemetry instrumentation, and switching it on and off. */

import type {Tracer, TracerProvider} from '@opentelemetry/api';
import {InstrumentationBase, type InstrumentationConfig} from '@opentelemetry/instrumentation';

import {check, type Plan, refuse} from './check.js';
import {className, messageOf, warn} from './log.js';
import {SCOPE_NAME, VERSION} from './package.js';
import * as patching from './patching.js';
import {startProvider} from './provider.js';
import * as state from './state.js';
import type {InferenceFormat} from './table.js';

/** The instrumentation whose hooks are on the SDK, if any: one at a time. */
let owner: A2uiInstrumentation | undefined;

/**
 * What starts the wrapper's own tracer provider for an instrumentation, when
 * `instrument()` made it. One an agent constructs itself has none: its spans
 * go to the provider it is handed.
 */
const lateStarts = new WeakMap<A2uiInstrumentation, () => void>();

/**
 * Starts the wrapper's provider at most once, the first time it is called.
 *
 * The wrapper calls it when its first event ends, not when it is switched on:
 * OpenTelemetry takes one global provider a process, so a provider the wrapper
 * registered at switch-on would refuse the one the agent registers after it,
 * with the agent's propagator and context manager.
 */
function lateStart(): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    try {
      startProvider();
    } catch (fault) {
      warn(
        'a2ui-spectra-instrumentation could not start a tracer provider ' +
          `(${className(fault)}: ${messageOf(fault)}); the spans go to a provider the process sets`,
      );
    }
  };
}

/**
 * Instruments upstream's A2UI agent SDK, `@a2ui/agent`, by replacing the
 * hooked methods on its exported classes' prototypes.
 *
 * Constructed, it switches itself on, as every OpenTelemetry instrumentation
 * does: an agent on its own NodeSDK adds `new A2uiInstrumentation()` to its
 * instrumentations, and the spans go to the provider it is handed. It starts
 * no provider; `instrument()` is the one-line form that does.
 */
export class A2uiInstrumentation extends InstrumentationBase<InstrumentationConfig> {
  constructor(config: InstrumentationConfig = {}) {
    super(SCOPE_NAME, VERSION, config);
  }

  protected init(): [] {
    return [];
  }

  /** Runs the pinned-API check and hooks the SDK, unless another instrumentation has. */
  override enable(): void {
    switchOn(this, () => this.tracer, lateStarts.get(this) ?? (() => {}));
  }

  /** Puts every original back, if this instrumentation hooked the SDK. */
  override disable(): void {
    if (owner === this) switchOff();
  }

  override isEnabled(): boolean {
    return owner === this;
  }
}

function formatOf(
  classes: ReadonlyArray<readonly [Function, InferenceFormat]>,
  value: unknown,
): InferenceFormat | undefined {
  return classes.find(([cls]) => value instanceof cls)?.[1];
}

/** Checks the SDK and hooks it for an instrumentation, whose tracer the spans go to. */
function switchOn(
  instrumentation: A2uiInstrumentation,
  tracer: () => Tracer,
  startProvider: () => void,
): void {
  if (owner === instrumentation) return;
  if (owner !== undefined) {
    warn('a2ui-spectra-instrumentation is already switched on; switching it on again does nothing');
    return;
  }
  let plan: Plan | undefined;
  try {
    plan = check();
  } catch (fault) {
    // Nothing the wrapper meets while it switches on is thrown into the agent.
    refuse(undefined, `its check failed (${className(fault)}: ${messageOf(fault)})`);
    return;
  }
  if (plan === undefined) return;
  state.activate({
    tracer,
    startProvider,
    sdkVersion: plan.sdkVersion,
    parserFormat: parser => formatOf(plan.parsers, parser),
    generatorFormat: generator => formatOf(plan.generators, generator),
  });
  try {
    patching.apply(plan);
  } catch (fault) {
    state.deactivate();
    refuse(plan.sdkVersion, `hooking it failed (${className(fault)}: ${messageOf(fault)})`);
    return;
  }
  owner = instrumentation;
}

function switchOff(): void {
  patching.remove();
  state.deactivate();
  owner = undefined;
}

export interface InstrumentOptions {
  /**
   * The provider the spans go to. By default the process's own, or one the
   * wrapper starts when its first span is written, if the process has none by
   * then and the environment names an OTLP endpoint.
   */
  tracerProvider?: TracerProvider;
}

/**
 * Switches the wrapper on: checks the SDK and hooks it. With no provider given
 * it starts a tracer provider when its first span is written, if the process
 * has none by then. A second call is one warning line and does nothing.
 */
export function instrument(options: InstrumentOptions = {}): void {
  if (owner !== undefined) {
    warn('a2ui-spectra-instrumentation is already switched on; instrument() does nothing');
    return;
  }
  const instrumentation = new A2uiInstrumentation({enabled: false});
  if (options.tracerProvider !== undefined) {
    instrumentation.setTracerProvider(options.tracerProvider);
  } else {
    lateStarts.set(instrumentation, lateStart());
  }
  instrumentation.enable();
}

/** Puts every original back. A tracer provider the wrapper started stays. */
export function uninstrument(): void {
  if (owner !== undefined) switchOff();
}
