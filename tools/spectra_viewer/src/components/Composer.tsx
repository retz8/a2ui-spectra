import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

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
 * first screen's examples fill. It is one line until typing, and grows with
 * its text up to six lines; Enter sends, and Shift+Enter starts a new line.
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
  inputRef?: RefObject<HTMLTextAreaElement | null>;
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
  const ownInput = useRef<HTMLTextAreaElement>(null);
  const field = inputRef ?? ownInput;

  // The field is as tall as its text, up to six lines, and scrolls past them.
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, FIELD_MAX)}px`;
  }, [text, field]);

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
  // A header's variable that is not set: the field stays, Send does not, and the reason takes the label's place.
  const refused = view.refused;

  // Focus in the composer when it sends comes back to its field once it can send again, unless it has moved on.
  const form = useRef<HTMLFormElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (disabled || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) field.current?.focus();
  }, [disabled, field]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '' || disabled || refused !== undefined) return;
    refocus.current = form.current?.contains(document.activeElement) ?? false;
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
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while an input method is composing is the input method's.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t px-4 pt-2.5 pb-3.5">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {refused === undefined ? (
          <>
            <Icon kind={icon} size={13} className={toneOf(icon)} />
            <span className="min-w-0 truncate">{label}</span>
          </>
        ) : (
          <span className="min-w-0 truncate">{refusedLine(refused)}</span>
        )}
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
          ref={form}
          onSubmit={event => void send(event)}
          className={cn(
            'ease-quick flex min-h-10 items-end gap-2 rounded-[10px] border py-1 pr-[5px] pl-3',
            'focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft',
            disabled ? 'bg-tint' : 'bg-panel',
          )}
        >
          <textarea
            ref={field}
            rows={1}
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
            className="max-h-[130px] min-w-0 flex-1 resize-none bg-transparent py-[5px] text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-default"
          />
          {!disabled && (
            <span className="shrink-0 pb-[7px] text-xs text-muted-foreground">Enter to send</span>
          )}
          <button
            type="submit"
            aria-label="Send"
            disabled={disabled || text.trim() === '' || refused !== undefined}
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

/** The refusal, the variables in monospace: "Can't send · SPECTRA_AGENT_TOKEN is not set in Spectra's environment". */
function refusedLine(variables: readonly string[]) {
  const names = variables.map((variable, index) => (
    <span key={variable}>
      {index > 0 && (index === variables.length - 1 ? ' and ' : ', ')}
      <code className="font-mono">{variable}</code>
    </span>
  ));
  return (
    <>
      Can't send · {names} {variables.length === 1 ? 'is' : 'are'} not set in Spectra's environment
    </>
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

/** The field's greatest height: six lines of 20px and its padding. */
const FIELD_MAX = 130;
