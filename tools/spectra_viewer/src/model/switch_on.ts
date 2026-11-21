/**
 * The hint for switching on a wrapper: each line as its wrapper's README gives it, under
 * "Install" and "Switch it on", and the README's page at this Spectra's version, one per
 * language.
 */

export interface SwitchOnLines {
  language: 'Python' | 'TypeScript';
  /** The wrapper's README, from the repository's root. */
  readme: string;
  install: string;
  launch: {label: string; code: string};
  line: {label: string; code: string};
}

export const SWITCH_ON_LINES: readonly SwitchOnLines[] = [
  {
    language: 'Python',
    readme: 'python/a2ui_spectra_instrumentation/README.md',
    install: 'uv add --dev a2ui-spectra-instrumentation',
    launch: {
      label: 'Launch under opentelemetry-instrument',
      code: 'a2ui-spectra run -- opentelemetry-instrument python agent.py',
    },
    line: {
      label: 'Or one line, before the agent parses or generates a prompt',
      code: 'import a2ui_spectra_instrumentation\n\na2ui_spectra_instrumentation.instrument()',
    },
  },
  {
    language: 'TypeScript',
    readme: 'typescript/instrumentation/README.md',
    install: 'npm install --save-dev a2ui-spectra-instrumentation',
    launch: {
      label: "Launch through Node's --import",
      code: 'a2ui-spectra run -- node --import a2ui-spectra-instrumentation/register agent.js',
    },
    line: {
      label: 'Or one line, before the agent parses or generates a prompt',
      code: "import {instrument} from 'a2ui-spectra-instrumentation';\n\ninstrument();",
    },
  },
];

/** The repository's pages on GitHub. */
const REPOSITORY = 'https://github.com/retz8/a2ui-spectra';

/**
 * A wrapper's README on GitHub at this Spectra's version tag, `v<version>`, and its link's
 * text; on `main` when the version is not known.
 */
export function readmeLink(
  readme: string,
  version: string | undefined,
): {href: string; text: string; ref: string} {
  const ref = version === undefined ? 'main' : `v${version}`;
  return {href: `${REPOSITORY}/blob/${ref}/${readme}`, text: `The README, at ${ref}`, ref};
}
