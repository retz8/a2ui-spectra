/**
 * The hook each hooked name gets.
 *
 * Every hook leaves the SDK's call as it is: it returns what the call returns
 * and throws what it throws. What the hook records around the call runs
 * guarded, and a failure in it is one warning line.
 */

import * as events from './events.js';
import {type Event, ParseEvent, PromptEvent, Silent} from './events.js';
import {reportFault, safely} from './log.js';
import * as state from './state.js';
import type {Active} from './state.js';
import type {Role} from './table.js';

type Method = (this: unknown, ...args: unknown[]) => unknown;

/** A stream's event lives with its stream object. */
const streams = new WeakMap<object, ParseEvent>();

/** A call the wrapper does not record: the calls nested in it open no event either. */
function unrecorded(active: Active, original: Method, self: unknown, args: unknown[]): unknown {
  const silent = new Silent(active);
  events.enter(silent);
  try {
    return original.apply(self, args);
  } finally {
    events.leave(silent);
  }
}

/** A hooked call made while an event is open: it opens none, and tells the open one. */
function inner(
  original: Method,
  self: unknown,
  args: unknown[],
  where: string,
  before?: () => void,
): unknown {
  if (before !== undefined) safely(where, before);
  return original.apply(self, args);
}

/** The outermost call: the event is open while it runs, and ends with it. */
function outermost(
  event: Event,
  original: Method,
  self: unknown,
  args: unknown[],
  where: string,
  returned: (result: unknown) => void,
): unknown {
  events.enter(event);
  let result: unknown;
  try {
    result = original.apply(self, args);
  } catch (error) {
    safely(where, () => event.fail(error));
    throw error;
  } finally {
    events.leave(event);
  }
  safely(where, () => returned(result));
  return result;
}

/** Whether the call said `wrapped: false`. */
function wrappedOf(options: unknown): boolean {
  return (options as {wrapped?: unknown} | null | undefined)?.wrapped !== false;
}

// The parsing entry points.

function parseResponse(original: Method): Method {
  const where = 'the parseResponse hook';
  return function (this: unknown, ...args: unknown[]): unknown {
    const active = state.current();
    if (active === undefined) return original.apply(this, args);
    const open = events.current();
    if (open !== undefined) {
      return inner(original, this, args, where, () => open.adoptParser(this));
    }
    let event: ParseEvent;
    try {
      event = new ParseEvent(active, 'parse_response', args[0]);
      event.wrapped = wrappedOf(args[1]);
      event.adoptParser(this);
    } catch (fault) {
      reportFault(where, fault);
      return unrecorded(active, original, this, args);
    }
    return outermost(event, original, this, args, where, parts => {
      event.takeParts(parts);
      event.end();
    });
  };
}

function compile(original: Method): Method {
  const where = 'the compile hook';
  return function (this: unknown, ...args: unknown[]): unknown {
    const active = state.current();
    if (active === undefined) return original.apply(this, args);
    const open = events.current();
    if (open !== undefined) {
      return inner(original, this, args, where, () => {
        open.adoptParser(this);
        open.noteCompile(args[0]);
      });
    }
    let event: ParseEvent;
    try {
      event = new ParseEvent(active, 'compile', args[0]);
      event.adoptParser(this);
      event.noteCompile(args[0]);
    } catch (fault) {
      reportFault(where, fault);
      return unrecorded(active, original, this, args);
    }
    return outermost(event, original, this, args, where, messages => {
      event.takeMessages(messages);
      event.end();
    });
  };
}

function openStream(original: Method): Method {
  const where = 'the openStream hook';
  return function (this: unknown, ...args: unknown[]): unknown {
    const active = state.current();
    if (active === undefined) return original.apply(this, args);
    const open = events.current();
    if (open !== undefined) return inner(original, this, args, where);
    let event: ParseEvent;
    try {
      event = new ParseEvent(active, 'open_stream');
      event.streamed = true;
      event.streamParser = this;
      event.wrapped = wrappedOf(args[0]);
      event.adoptParser(this);
    } catch (fault) {
      reportFault(where, fault);
      return unrecorded(active, original, this, args);
    }
    return outermost(event, original, this, args, where, stream => {
      if (typeof stream === 'object' && stream !== null) streams.set(stream, event);
    });
  };
}

/** A `feed` or `close` on a stream with an event, which is the open event while it runs. */
function streamCall(original: Method, closing: boolean): Method {
  const where = closing ? 'the close hook' : 'the feed hook';
  return function (this: unknown, ...args: unknown[]): unknown {
    const active = state.current();
    if (active === undefined) return original.apply(this, args);
    const event = typeof this === 'object' && this !== null ? streams.get(this) : undefined;
    if (event === undefined || event.ended) {
      // A stream opened unrecorded, or one that has ended: nothing in it is recorded.
      return unrecorded(active, original, this, args);
    }
    if (!closing) {
      try {
        event.feed(args[0]);
      } catch (fault) {
        reportFault(where, fault);
        event.abandon();
        return unrecorded(active, original, this, args);
      }
    }
    return outermost(event, original, this, args, where, parts => {
      event.takeParts(parts);
      if (closing) event.end();
    });
  };
}

/** The check of whole trees: an error it throws belongs to no block, and a stream counts each it passes. */
function checkTopology(original: Method): Method {
  const where = 'the checkTopology hook';
  return function (this: unknown, ...args: unknown[]): unknown {
    const open = state.current() === undefined ? undefined : events.current();
    if (open === undefined) return original.apply(this, args);
    safely(where, () => open.startWholeTree());
    let returned = false;
    try {
      const result = original.apply(this, args);
      returned = true;
      return result;
    } catch (error) {
      safely(where, () => open.escapedWholeTree(error));
      throw error;
    } finally {
      safely(where, () => open.finishWholeTree(returned));
    }
  };
}

/** A stream marks the components of a block it rejected as checked when it catches the error. */
function markChecked(original: Method): Method {
  const where = 'the markChecked hook';
  return function (this: unknown, ...args: unknown[]): unknown {
    const open = state.current() === undefined ? undefined : events.current();
    if (open !== undefined) safely(where, () => open.noteMarkChecked());
    return original.apply(this, args);
  };
}

// The prompt generators.

function generate(original: Method): Method {
  const where = 'the generate hook';
  return function (this: unknown, ...args: unknown[]): unknown {
    const active = state.current();
    if (active === undefined) return original.apply(this, args);
    const open = events.current();
    if (open !== undefined) {
      return inner(original, this, args, where, () => open.adoptGenerator(this));
    }
    let event: PromptEvent;
    try {
      event = new PromptEvent(active);
      event.adoptGenerator(this);
    } catch (fault) {
      reportFault(where, fault);
      return unrecorded(active, original, this, args);
    }
    return outermost(event, original, this, args, where, section => event.takeSection(section));
  };
}

/** The hook a hooked name gets. */
export function hookFor(role: Role, original: Method): Method {
  switch (role) {
    case 'parse_response':
      return parseResponse(original);
    case 'compile':
      return compile(original);
    case 'open_stream':
      return openStream(original);
    case 'feed':
      return streamCall(original, false);
    case 'close':
      return streamCall(original, true);
    case 'generate':
      return generate(original);
    case 'check_topology':
      return checkTopology(original);
    case 'mark_checked':
      return markChecked(original);
  }
}
