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

/**
 * What a reader knows of the catalogs: which names make components, how a
 * component's positional arguments fill its properties, and which
 * components hold children.
 */
export interface ReaderCatalog {
  /** Whether a call, tag or form of this name makes a component. */
  isComponent(name: string): boolean;
  /** A component's properties in the order its positional arguments fill them, when known. */
  propertyOrder(name: string): readonly string[] | undefined;
  /** Whether a component holds child components, when known. */
  isContainer(name: string): boolean | undefined;
}

/** The names that are never components, whichever catalog: the SDKs' own helpers. */
const BUILTINS = new Set(['Event', '_template', 'surface', 'deleteSurface']);

/** Without a catalog: a capitalised name that is not a builtin is a component, and nothing else is known. */
export const ANY_CATALOG: ReaderCatalog = {
  isComponent: name => /^[A-Z]/.test(name) && !BUILTINS.has(name),
  propertyOrder: () => undefined,
  isContainer: () => undefined,
};

export type BlockReader = (
  text: string,
  start: number,
  end: number,
  catalog: ReaderCatalog,
) => BlockReading;
