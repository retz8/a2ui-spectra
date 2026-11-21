/**
 * A request for the step's detail to open a tab other than the one a
 * selection opens, once the selection lands: the Prompt tab of the earlier
 * call a prefix break names, where the line it compares stands.
 */

let requested: string | undefined;

export function requestDetailTab(tab: string): void {
  requested = tab;
}

/** The tab requested, if any; read as the detail is first drawn, and cleared once it is. */
export function detailTabRequest(): string | undefined {
  return requested;
}

export function clearDetailTabRequest(): void {
  requested = undefined;
}
