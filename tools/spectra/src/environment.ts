/**
 * Spectra's own environment as it reads it, and the agent's as it sets it.
 * On Windows, where "environment variables are case-insensitive" (Node's
 * `process.env`), a variable Spectra reads is found in any case, and one it
 * sets replaces the developer's variable of that name in any case.
 */

/** Spectra's own environment, read by name: on Windows a name is found in any case. */
export function ownEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform !== 'win32') return env;
  const keyOf = (name: string): string | undefined => {
    if (name in env) return name;
    const upper = name.toUpperCase();
    return Object.keys(env).find(key => key.toUpperCase() === upper);
  };
  return new Proxy(env, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      const key = keyOf(name);
      return key === undefined ? undefined : target[key];
    },
    has(_target, name) {
      return typeof name === 'string' && keyOf(name) !== undefined;
    },
  });
}

/**
 * The agent's environment: Spectra's own with the variables given added, each
 * replacing the variable of its name, and on Windows the variable of its name
 * in any case.
 */
export function agentEnvironment(
  own: NodeJS.ProcessEnv,
  added: Readonly<Record<string, string>>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const fold = (name: string) => (platform === 'win32' ? name.toUpperCase() : name);
  const replaced = new Set(Object.keys(added).map(fold));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(own)) {
    if (value !== undefined && !replaced.has(fold(name))) env[name] = value;
  }
  return {...env, ...added};
}

/**
 * What Spectra sets for a Python agent, unless the developer's environment
 * sets it: under `run`, `PYTHONUNBUFFERED`, since Python holds its stdout back
 * when it is not a terminal; and on Windows `PYTHONIOENCODING=utf-8`, since
 * Python writes a pipe in the system's ANSI code page and Spectra reads the
 * agent's output as UTF-8, unless `PYTHONUTF8` is set.
 */
export function pythonVariables(
  own: NodeJS.ProcessEnv,
  {unbuffered}: {unbuffered: boolean},
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  return {
    ...(unbuffered && own.PYTHONUNBUFFERED === undefined && {PYTHONUNBUFFERED: '1'}),
    ...(platform === 'win32' &&
      own.PYTHONIOENCODING === undefined &&
      own.PYTHONUTF8 === undefined && {PYTHONIOENCODING: 'utf-8'}),
  };
}
