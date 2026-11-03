/**
 * The wrapper's lines. A refusal and a fault inside a hook are warnings, which
 * Node prints by default; the rest go through OpenTelemetry's `diag`, hidden
 * unless the process sets a diag logger.
 */

import {diag} from '@opentelemetry/api';

import {SCOPE_NAME} from './package.js';

export const logger = diag.createComponentLogger({namespace: SCOPE_NAME});

/** One warning line. */
export function warn(message: string): void {
  process.emitWarning(message);
}

/** A thrown value's class name. */
export function className(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as {constructor?: {name?: unknown}}).constructor?.name;
    if (typeof name === 'string' && name !== '') return name;
  }
  return typeof error;
}

/** A thrown value's message. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The line a failure inside a hook writes; the SDK's call goes on as if unhooked. */
export function reportFault(where: string, fault: unknown): void {
  warn(
    `a2ui-spectra-instrumentation: ${where} failed (${className(fault)}: ${messageOf(fault)}); ` +
      "this call's A2UI step is not recorded",
  );
}

/** Runs what a hook records around the SDK's call, reporting a failure instead of throwing it. */
export function safely(where: string, action: () => void): void {
  try {
    action();
  } catch (fault) {
    reportFault(where, fault);
  }
}
