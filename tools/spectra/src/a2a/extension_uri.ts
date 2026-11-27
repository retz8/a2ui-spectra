/**
 * A2UI's A2A extension URI: `https://a2ui.org/a2a-extension/a2ui/` followed
 * by the protocol version it stands for, as each version's A2UI extension
 * specification states it, such as `https://a2ui.org/a2a-extension/a2ui/v0.9`.
 */

/** The start of each A2UI extension's URI, followed by its version. */
export const A2UI_EXTENSION_PREFIX = 'https://a2ui.org/a2a-extension/a2ui/';

/** An A2UI extension URI as read: `http` or `https`, the version, and a trailing slash or none. */
const A2UI_EXTENSION_URI = /^https?:\/\/a2ui\.org\/a2a-extension\/a2ui\/(v\d+(?:\.\d+)*)\/?$/;

/** The extension URI of a protocol version written as it names itself, such as `v0.9`. */
export function a2uiExtensionUri(version: string): string {
  return `${A2UI_EXTENSION_PREFIX}${version}`;
}

/** The protocol version an A2UI extension URI stands for, such as `v0.9`; none for any other URI. */
export function a2uiExtensionVersion(uri: string): string | undefined {
  return A2UI_EXTENSION_URI.exec(uri)?.[1];
}
