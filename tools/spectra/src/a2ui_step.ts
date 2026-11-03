/**
 * The A2UI step's errors as the viewer counts them, for the listing's
 * `a2uiStepErrors`; the viewer's `model/a2ui_step.ts` holds the same rule.
 * Each `exception` span event of a parse is one, a failed parse that
 * carries none is one, and a failed prompt generation is one.
 */
import {isEventOfKind, type TurnRecordEvent} from './record/turn_record.js';

export function a2uiStepErrorsOf(events: readonly TurnRecordEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (isEventOfKind(event, 'parse')) {
      const exceptions = (event.events ?? []).filter(spanEvent => spanEvent.name === 'exception');
      count += exceptions.length > 0 ? exceptions.length : event.status?.code === 2 ? 1 : 0;
    } else if (isEventOfKind(event, 'prompt_generation') && event.status?.code === 2) {
      count += 1;
    }
  }
  return count;
}
