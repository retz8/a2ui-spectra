/**
 * What a header or bar control shares when it can be off and when a press of
 * it can be refused: a tooltip that says what the press does and, while it is
 * off, why; and a popover that opens only on a refused press, with the
 * server's sentence in the failure line the Replay popover uses.
 */
import {Popover, Tooltip} from 'radix-ui';
import {type ReactNode, useState} from 'react';

import {cn} from '@/lib/utils';

import {Icon} from './icons.tsx';

/** The problem-style line a popover says a failure in. */
export function FailureLine({text, className}: {text: string; className?: string}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg bg-problem-soft px-2.5 py-2 text-xs leading-4',
        className,
      )}
    >
      <Icon kind="failed" size={14} className="text-problem" />
      <span className="min-w-0 wrap-anywhere">{text}</span>
    </div>
  );
}

/**
 * A quiet button with its tooltip, the form the turn header's actions take.
 * Off, it keeps its label in muted text, stays reachable by Tab so its
 * tooltip, which carries why under its first line, can be read, and a press
 * does nothing. A press the server refuses, or whose request fails, shows the
 * answer in a popover anchored under the button, which closes on a press
 * outside, on Escape, or on the next press of the button.
 */
export function PressButton({
  label,
  icon,
  tooltip,
  note,
  off,
  onPress,
  refusalLabel,
  className,
}: {
  label: string;
  icon: ReactNode;
  /** The tooltip's first line. */
  tooltip: string;
  /** Why it is off, under the first line. */
  note?: string;
  off: boolean;
  /** Does the press's work; a rejection is shown as the refusal. */
  onPress: () => Promise<void>;
  /** The refusal popover's accessible name. */
  refusalLabel: string;
  className?: string;
}) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const [pressing, setPressing] = useState(false);
  const press = async () => {
    setRefusal(undefined);
    if (off || pressing) return;
    setPressing(true);
    try {
      await onPress();
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPressing(false);
    }
  };
  return (
    <Popover.Root
      open={refusal !== undefined}
      onOpenChange={open => {
        if (!open) setRefusal(undefined);
      }}
    >
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Popover.Anchor asChild>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-disabled={off}
                onClick={() => void press()}
                className={cn(
                  'ease-quick inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border bg-panel pr-2.5 pl-2 text-xs font-medium whitespace-nowrap',
                  off ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer hover:bg-tint',
                  className,
                )}
              >
                <span className="inline-flex text-muted-foreground">{icon}</span>
                {label}
              </button>
            </Tooltip.Trigger>
          </Popover.Anchor>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              align="end"
              sideOffset={6}
              className="fade-in-quick z-50 flex flex-col gap-0.5 rounded-lg bg-panel px-2.5 py-2 text-xs whitespace-nowrap text-foreground shadow-float"
            >
              <span>{tooltip}</span>
              {note !== undefined && (
                <span className="font-medium text-muted-foreground">{note}</span>
              )}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label={refusalLabel}
          onOpenAutoFocus={event => event.preventDefault()}
          className="fade-in-quick z-50 w-85 rounded-xl bg-panel p-1.5 text-foreground shadow-float"
        >
          <FailureLine text={refusal ?? ''} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
