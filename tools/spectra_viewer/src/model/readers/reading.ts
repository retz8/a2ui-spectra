/** What a format's reader finds in one block, and what it knows of the catalogs. */

export interface FoundComponent {
  componentId: string;
  /** The surface the text names for it, when it does. */
  surfaceId?: string;
  start: number;
  end: number;
}

export interface BlockReading {
  components: FoundComponent[];
  /** Where the reader stopped, when it could not finish the block. */
  stoppedAt?: number;
}

/** The SDK whose compiler a reader follows where Python's and TypeScript's disagree. */
export type ReaderSdk = 'python' | 'typescript';

/**
 * What a reader knows of a parse's catalogs: which names make components,
 * how a component's positional arguments fill its properties, and which
 * components hold children. A call that names its catalog, Express's
 * `catalogId=` or Atom's `:catalogId`, passes it.
 */
export interface ReaderCatalog {
  /** The SDK whose rules apply where the two compilers disagree. */
  readonly sdk: ReaderSdk;
  /** Whether a call, tag or form of this name makes a component. */
  isComponent(name: string, catalogId?: string): boolean;
  /** A component's properties in the order its positional arguments fill them, when known. */
  propertyOrder(name: string, catalogId?: string): readonly string[] | undefined;
  /** Whether a component holds child components, when known. */
  isContainer(name: string, catalogId?: string): boolean | undefined;
  /** Whether a bare string child of a component becomes a text component of its catalog, when known. */
  wrapsBareStrings(name: string, catalogId?: string): boolean | undefined;
}

/** The names that are never components, whichever catalog: the SDKs' own helpers. */
const BUILTINS = new Set(['Event', '_template', 'surface', 'deleteSurface']);

/** The no-catalog rule: a capitalised name that is not a helper is a component, and nothing else is known. */
export function isComponentWithoutCatalog(name: string): boolean {
  return /^[A-Z]/.test(name) && !BUILTINS.has(name);
}

/** Without a catalog: the no-catalog rule for every name, and Python's form of each rule. */
export const ANY_CATALOG: ReaderCatalog = {
  sdk: 'python',
  isComponent: isComponentWithoutCatalog,
  propertyOrder: () => undefined,
  isContainer: () => undefined,
  wrapsBareStrings: () => undefined,
};

export type BlockReader = (
  text: string,
  start: number,
  end: number,
  catalog: ReaderCatalog,
) => BlockReading;
