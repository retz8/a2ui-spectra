/**
 * The file names Windows cannot hold, as Microsoft Learn's "Naming Files,
 * Paths, and Namespaces" gives them: the reserved device names, alone or
 * followed immediately by an extension, and a name ending in a space or a
 * period. The page says not to assume case sensitivity, so the device names
 * are matched in any case.
 */

/** CON, PRN, AUX, NUL, COM1 to COM9 and LPT1 to LPT9, with ¹, ² and ³ as digits. */
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;

/** Whether a file name is a reserved device name, alone or before an extension. */
export function isReservedDeviceName(name: string): boolean {
  const dot = name.indexOf('.');
  return RESERVED.test(dot === -1 ? name : name.slice(0, dot));
}

/** Whether Windows can hold a file or folder of that name. */
export function windowsCanHold(name: string): boolean {
  return !isReservedDeviceName(name) && !/[ .]$/.test(name);
}

/** The reserved device names, as a line names them. */
export const RESERVED_NAMES_PHRASE = 'CON, PRN, AUX, NUL, COM1 to COM9 or LPT1 to LPT9';
