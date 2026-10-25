import {type FormEvent, type KeyboardEvent, useState} from 'react';

import {cn} from '@/lib/utils';
import {composerOf} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

import {STATUS_ICONS, toneOf} from './format.ts';
import {Icon, type IconKind} from './icons.tsx';

/**
 * The message box, docked under the turn view: it sends in the box's own
 * conversation, says which one that is, and offers a new conversation.
 */
export function Composer({onSent}: {onSent: (traceId: string) => void}) {
  const state = useSpectra();
  const view = composerOf(state);
  const agent = state.context?.agentName ?? 'the agent';
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  const continues = view.continues;
  const icon: IconKind =
    view.waiting === 'A turn is open'
      ? 'open'
      : continues === undefined
        ? 'plus'
        : STATUS_ICONS[continues.open ? 'open' : (continues.outcome ?? 'open')];
  const label =
    view.waiting === 'A turn is open'
      ? 'A turn is open'
      : continues === undefined
        ? 'New conversation'
        : `Continue “${continues.title}”`;
  const disabled = view.waiting !== undefined || sending;

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '' || disabled) return;
    setSending(true);
    setError(undefined);
    try {
      const traceId = await spectra.send(text);
      setText('');
      onSent(traceId);
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
        {continues !== undefined && (
          <button
            type="button"
            disabled={state.connected === false}
            onClick={() => {
              setError(undefined);
              spectra
                .newConversation()
                .catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : String(caught)),
                );
            }}
            className="ease-quick inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 font-medium hover:bg-tint hover:text-foreground disabled:cursor-default disabled:opacity-50"
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
            type="text"
            aria-label="Message the agent"
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            placeholder={
              view.waiting === 'A turn is open'
                ? 'Waiting for the turn to finish'
                : (view.waiting ?? `Message ${agent}`)
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
