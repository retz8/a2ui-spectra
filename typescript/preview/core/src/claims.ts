/**
 * A page's claims: the catalogs it passes to its renderer, each with its id
 * and the protocol version its definition targets, as web core's catalog
 * object carries them. The adopter declares nothing.
 */
import type {Claim} from './protocol.js';

/** What a catalog object gives a claim: web core's `Catalog` has both. */
export interface ClaimedCatalog {
  readonly id: string;
  readonly protocolVersion: string;
}

/** The claims of a page's catalogs, in their order, each once. */
export function claimsOf(catalogs: Iterable<ClaimedCatalog>): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  for (const {id, protocolVersion} of catalogs) {
    const key = JSON.stringify([id, protocolVersion]);
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({catalogId: id, protocolVersion: String(protocolVersion)});
  }
  return claims;
}
