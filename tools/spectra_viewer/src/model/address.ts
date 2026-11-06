/**
 * The page address. In Turns: the turn in view, its selected step and, after
 * the step, the selected tree node, as `#/turns/<trace id>`,
 * `#/turns/<trace id>/steps/<step id>` or
 * `#/turns/<trace id>/steps/<step id>/nodes/<surface id>/<component id>`, the
 * node's ids encoded. In Fixtures: the fixture by its name, encoded, the name
 * being its path under the folder, and its turn by the recorded trace id, as
 * `#/fixtures`, `#/fixtures/<name>` or `#/fixtures/<name>/turns/<trace id>`,
 * followed by the step and the node as the Turns address carries them.
 * Changing the section, the fixture or the turn adds an entry to the browser's
 * history; changing the step or the node, or the viewer's own move, replaces
 * it.
 */

export type Section = 'turns' | 'fixtures';

/** A tree node, by its surface and its component id. */
export interface NodeRef {
  surfaceId: string;
  componentId: string;
}

export interface Address {
  /** Set on an address of the Fixtures section; an address of Turns has none. */
  section?: 'fixtures';
  /** The fixture in view, by its name. */
  fixture?: string;
  traceId?: string;
  stepId?: string;
  node?: NodeRef;
}

const TURN = String.raw`\/turns\/([0-9a-f]{32})(?:\/steps\/([A-Za-z0-9._-]+)(?:\/nodes\/([^/]+)\/([^/]+))?)?`;
const ADDRESS = new RegExp(`^#${TURN}$`);
const FIXTURE_ADDRESS = new RegExp(String.raw`^#\/fixtures(?:\/([^/]+)(?:${TURN})?)?$`);

/** The turn, the step and the node of a matched address's groups. */
function turnOf(
  traceId: string | undefined,
  stepId: string | undefined,
  surfaceId: string | undefined,
  componentId: string | undefined,
): Address {
  return {
    ...(traceId !== undefined && {traceId}),
    ...(stepId !== undefined && {stepId}),
    ...(surfaceId !== undefined &&
      componentId !== undefined && {
        node: {
          surfaceId: decodeURIComponent(surfaceId),
          componentId: decodeURIComponent(componentId),
        },
      }),
  };
}

/**
 * What a page address holds: a turn with its step and its node; in Fixtures,
 * the fixture too; nothing when it holds neither a turn nor Fixtures.
 */
export function readAddress(hash: string): Address {
  const fixture = FIXTURE_ADDRESS.exec(hash);
  if (fixture !== null) {
    const [, name, traceId, stepId, surfaceId, componentId] = fixture;
    return {
      section: 'fixtures',
      ...(name !== undefined && {fixture: decodeURIComponent(name)}),
      ...turnOf(traceId, stepId, surfaceId, componentId),
    };
  }
  const match = ADDRESS.exec(hash);
  if (match === null) return {};
  const [, traceId, stepId, surfaceId, componentId] = match;
  return turnOf(traceId, stepId, surfaceId, componentId);
}

/** The page address of a turn and, when selected, its step and its node. */
export function writeAddress(traceId: string, stepId?: string, node?: NodeRef): string {
  if (stepId === undefined) return `#/turns/${traceId}`;
  const step = `#/turns/${traceId}/steps/${stepId}`;
  return node === undefined
    ? step
    : `${step}/nodes/${encodeURIComponent(node.surfaceId)}/${encodeURIComponent(node.componentId)}`;
}

/** The page address of a fixture and, when selected, its turn, its step and its node. */
export function writeFixtureAddress(
  name?: string,
  traceId?: string,
  stepId?: string,
  node?: NodeRef,
): string {
  if (name === undefined) return '#/fixtures';
  const fixture = `#/fixtures/${encodeURIComponent(name)}`;
  return traceId === undefined
    ? fixture
    : `${fixture}${writeAddress(traceId, stepId, node).slice(1)}`;
}

/** The page address of what an address holds. */
export function hashOf(address: Address): string {
  const {fixture, traceId, stepId, node} = address;
  if (address.section === 'fixtures') return writeFixtureAddress(fixture, traceId, stepId, node);
  return traceId === undefined ? '#/turns' : writeAddress(traceId, stepId, node);
}

/** The section an address is in. */
export function sectionOf(address: Address): Section {
  return address.section ?? 'turns';
}

function sameNode(a: NodeRef | undefined, b: NodeRef | undefined): boolean {
  return a?.surfaceId === b?.surfaceId && a?.componentId === b?.componentId;
}

/**
 * How moving from one address to another goes into the browser's history: a
 * new entry for another section, fixture or turn, the entry replaced for
 * another step of the same turn or for the viewer's own move, and nothing
 * when the address stays.
 */
export function historyOf(
  from: Address,
  to: Address,
  {own}: {own: boolean},
): 'push' | 'replace' | 'none' {
  const sameTurn =
    sectionOf(from) === sectionOf(to) && from.fixture === to.fixture && from.traceId === to.traceId;
  if (sameTurn && from.stepId === to.stepId && sameNode(from.node, to.node)) return 'none';
  if (own || sameTurn) return 'replace';
  return 'push';
}

/** The address each section was last on, for the session. */
export type RememberedSections = Readonly<Partial<Record<Section, string>>>;

/**
 * The sections' addresses with the page's address noted under its own
 * section; the same object when nothing changed. An address of Turns with no
 * turn in it says nothing of where Turns was.
 */
export function rememberAddress(remembered: RememberedSections, hash: string): RememberedSections {
  const address = readAddress(hash);
  if (address.section === undefined && address.traceId === undefined) return remembered;
  const section = sectionOf(address);
  return remembered[section] === hash ? remembered : {...remembered, [section]: hash};
}

/** Where switching to a section goes: the address it was last on, else the section's bare address. */
export function sectionHash(section: Section, remembered: RememberedSections): string {
  return remembered[section] ?? (section === 'fixtures' ? '#/fixtures' : '#/turns');
}
