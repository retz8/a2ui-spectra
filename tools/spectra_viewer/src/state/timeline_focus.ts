/**
 * A request for the timeline to take focus once a selection made away from
 * it lands, such as the step a link in the step's detail selects, the earlier
 * call a prefix break names or the parse a retry failed, so that the keys go
 * on from the selected row.
 */

let requested = false;

export function requestTimelineFocus(): void {
  requested = true;
}

/** Whether a request is pending; taking it clears it. */
export function takeTimelineFocusRequest(): boolean {
  const pending = requested;
  requested = false;
  return pending;
}
