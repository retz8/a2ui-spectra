/**
 * A quiet spell: one call, the spell after the last notice, however many
 * notices came before it. A burst of file events is told once this way.
 */
export interface QuietSpell {
  /** Something happened: the spell starts again. */
  notice(): void;
  /** Drops the call that is waiting, when one is. */
  cancel(): void;
}

export function quietSpell(onQuiet: () => void, ms: number): QuietSpell {
  let timer: NodeJS.Timeout | undefined;
  return {
    notice() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        onQuiet();
      }, ms);
      timer.unref();
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
