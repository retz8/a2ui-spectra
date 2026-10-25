import {type FormEvent, type KeyboardEvent, type Ref, useState} from 'react';

import {cn} from '@/lib/utils';
import {type ComposerTarget, composerOf} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

import {STATUS_ICONS, toneOf} from './format.ts';
import {Icon, type IconKind} from './icons.tsx';

/**
 * The message box, docked under the turn view: it continues the conversation
 * of the turn in view when the box started it, and otherwise starts a new
 * one, saying which and why; it says when the agent is waiting for input, and
 * offers a new conversation. Its text is held by the turn view, which the
 * first screen's examples fill.
 */
export function Composer({
  text,
  onText,
  inputRef,
  onSent,
  traceId,
  startsNew,
  onStartNew,
}: {
  text: string;
  onText: (text: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  onSent: (traceId: string) => void;
  /** The turn in view. */
  traceId: string | undefined;
  /** Whether a new conversation was asked for while this turn is in view. */
  startsNew: boolean;
  onStartNew: () => void;
}) {
  const state = useSpectra();
  const view = composerOf(state, {traceId, startsNew});
  const agent = state.context?.agentName ?? 'the agent';
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  const {target} = view;
  const turnOpen = view.waiting === 'A turn is open';
  const waitsForInput = target.kind === 'continues' && target.outcome === 'waiting_for_input';
  const icon: IconKind = turnOpen
    ? 'open'
    : target.kind === 'continues'
      ? STATUS_ICONS[target.open ? 'open' : (target.outcome ?? 'open')]
      : 'plus';
  const label = turnOpen ? 'A turn is open' : labelOf(target);
  const disabled = view.waiting !== undefined || sending;

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '' || disabled) return;
    setSending(true);
    setError(undefined);
    try {
      const sent = await spectra.send(
        text,
        target.kind === 'continues' ? target.conversationId : undefined,
      );
      onText('');
      onSent(sent);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t px-4 pt-2.5 pb-3.5">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon kind={icon} size={13} className={toneOf(icon)} />
        <span className="min-w-0 truncate">{label}</span>
        <div className="flex-1" />
        {target.kind !== 'new' && (
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              onStartNew();
            }}
            className="ease-quick inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 font-medium hover:bg-tint hover:text-foreground"
          >
            <Icon kind="plus" size={13} />
            New conversation
          </button>
        )}
      </div>
      {view.unavailable !== undefined ? (
        <p className="text-muted-foreground">{view.unavailable}</p>
      ) : (
        <form
          onSubmit={event => void send(event)}
          className={cn(
            'ease-quick flex h-10 items-center gap-2 rounded-[10px] border pr-[5px] pl-3',
            'focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft',
            disabled ? 'bg-tint' : 'bg-panel',
          )}
        >
          <input
            ref={inputRef}
            type="text"
            aria-label="Message the agent"
            value={text}
            onChange={event => onText(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            placeholder={
              turnOpen
                ? 'Waiting for the turn to finish'
                : (view.waiting ?? (waitsForInput ? `Reply to ${agent}` : `Message ${agent}`))
            }
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-default"
          />
          {!disabled && (
            <span className="shrink-0 text-xs text-muted-foreground">Enter to send</span>
          )}
          <button
            type="submit"
            aria-label="Send"
            disabled={disabled || text.trim() === ''}
            className="ease-quick flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-brand text-brand-on disabled:cursor-default disabled:bg-border disabled:text-muted-foreground"
          >
            <Icon kind="send" size={15} />
          </button>
        </form>
      )}
      {error !== undefined && <p className="text-xs text-problem">{error}</p>}
    </div>
  );
}

/** What the composer's line says of where it sends. */
function labelOf(target: ComposerTarget): string {
  switch (target.kind) {
    case 'continues':
      return `Continue “${target.title}”${target.outcome === 'waiting_for_input' ? ' · the agent is waiting for input' : ''}`;
    case 'new':
      return 'New conversation';
    case 'notStarted':
      return 'Started by another host or in an earlier run · sending starts a new conversation';
    case 'unnamed':
      return 'The agent named no conversation · sending starts a new conversation';
  }
}
