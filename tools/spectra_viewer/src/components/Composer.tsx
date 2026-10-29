import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type {BoxInput} from '@/api.ts';
import {cn} from '@/lib/utils';
import {type DataModelMap, foldedAtFirst, shownMessageOf} from '@/model/host_message.ts';
import type {PendingAction} from '@/state/press.ts';
import {actionRefusalOf, type ComposerTarget, composerOf} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

import {CopyButton} from './CopyButton.tsx';
import {STATUS_ICONS, toneOf} from './format.ts';
import {Icon, type IconKind} from './icons.tsx';
import {JsonLines} from './JsonBlock.tsx';

/**
 * The message box, docked under the turn view: it continues the conversation
 * of the turn in view when the box started it, and otherwise starts a new
 * one, saying which and why; it says when the agent is waiting for input, and
 * offers a new conversation. Its text is held by the turn view, which the
 * first screen's examples fill. It is one line until typing, and grows with
 * its text up to six lines; Enter sends, and Shift+Enter starts a new line.
 * A text carries the data model at the step in view. An action pressed in
 * the preview takes the text's place, as the wire message the agent would
 * receive, with Send, which Enter presses once it lands, and Discard, which
 * Escape presses; the text stays under it.
 */
export function Composer({
  text,
  onText,
  inputRef,
  onSent,
  traceId,
  startsNew,
  onStartNew,
  pending,
  onDiscard,
  dataModel,
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
  /** The action pressed in the preview, pending in place of the text. */
  pending?: PendingAction;
  /** Takes the pending action out, leaving the text. */
  onDiscard: () => void;
  /** The data model at the step in view, which a text carries. */
  dataModel?: DataModelMap;
}) {
  const state = useSpectra();
  const view = composerOf(state, {traceId, startsNew});
  const agent = state.context?.agentName ?? 'the agent';
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const ownInput = useRef<HTMLTextAreaElement>(null);
  const field = inputRef ?? ownInput;
  const sendButton = useRef<HTMLButtonElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);

  // The field is as tall as its text, up to six lines, and scrolls past them.
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, FIELD_MAX)}px`;
  }, [text, field, pending]);

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
  // An action only continues a conversation the box started; elsewhere the reason takes the label's place.
  const actionRefused = pending === undefined ? undefined : actionRefusalOf(target);
  const actionOff = disabled || refused !== undefined || actionRefused !== undefined;

  // Focus in the composer when it sends comes back to its field once it can send again, unless it has moved on.
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (disabled || !refocus.current || pending !== undefined) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) field.current?.focus();
  }, [disabled, field, pending]);

  // A press lands with focus on Send, so Enter sends it; on Discard when it cannot be sent.
  useEffect(() => {
    if (pending === undefined) return;
    (sendButton.current?.disabled === false ? sendButton : discardButton).current?.focus();
  }, [pending]);

  // The action discarded, focus goes back to the text it was in place of.
  const toField = useRef(false);
  useEffect(() => {
    if (pending !== undefined || !toField.current) return;
    toField.current = false;
    field.current?.focus();
  }, [pending, field]);
  const discard = () => {
    toField.current = box.current?.contains(document.activeElement) ?? false;
    setError(undefined);
    onDiscard();
  };

  const post = async (input: BoxInput, sent: () => void) => {
    refocus.current =
      (form.current?.contains(document.activeElement) ?? false) ||
      (box.current?.contains(document.activeElement) ?? false);
    setSending(true);
    setError(undefined);
    try {
      const traceId = await spectra.send(
        input,
        target.kind === 'continues' ? target.conversationId : undefined,
      );
      sent();
      onSent(traceId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  };
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '' || disabled || refused !== undefined) return;
    const carried = target.kind === 'continues' && dataModel !== undefined ? {dataModel} : {};
    await post({text, ...carried}, () => onText(''));
  };
  const sendAction = async () => {
    if (pending === undefined || actionOff) return;
    const carried = pending.dataModel !== undefined ? {dataModel: pending.dataModel} : {};
    // Sent, the action leaves the composer and the text under it stays.
    await post({action: pending.message, ...carried}, onDiscard);
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
        {refused !== undefined ? (
          <span className="min-w-0 truncate">{refusedLine(refused)}</span>
        ) : actionRefused !== undefined ? (
          <>
            <Icon kind="failed" size={13} />
            <span className="min-w-0 truncate">{actionRefused}</span>
          </>
        ) : (
          <>
            <Icon kind={icon} size={13} className={toneOf(icon)} />
            <span className="min-w-0 truncate">{label}</span>
          </>
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
      ) : pending !== undefined ? (
        <PendingBox
          boxRef={box}
          pending={pending}
          a2a={state.box.a2aVersion}
          sendOff={actionOff}
          sendRef={sendButton}
          discardRef={discardButton}
          onSend={() => void sendAction()}
          onDiscard={discard}
        />
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

/**
 * The pending action: a title line naming the action, its source component
 * and its surface, with Copy, Discard and Send; under it the wire message,
 * its envelope open and the data model folded, six lines high and scrolling.
 */
function PendingBox({
  boxRef,
  pending,
  a2a,
  sendOff,
  sendRef,
  discardRef,
  onSend,
  onDiscard,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  pending: PendingAction;
  a2a: '0.3' | '1.0' | undefined;
  sendOff: boolean;
  sendRef: RefObject<HTMLButtonElement | null>;
  discardRef: RefObject<HTMLButtonElement | null>;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const {action} = pending.message;
  const shown = shownMessageOf(pending.message, pending.dataModel, a2a);
  const source = [pending.componentType, action.sourceComponentId].filter(Boolean).join(' ');
  return (
    <div
      ref={boxRef}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onDiscard();
      }}
      className="ease-quick flex flex-col gap-1.5 rounded-[10px] border bg-panel py-[5px] pr-[5px] pb-2.5 pl-3 focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft"
    >
      <div className="flex h-[30px] min-w-0 items-center gap-2">
        <Icon kind="input" size={14} className="shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-semibold">Action “{action.name}”</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          from {source} on surface {action.surfaceId}
        </span>
        <div className="flex-1" />
        <CopyButton
          text={JSON.stringify(shown, null, 2)}
          label="Copy the action"
          className="h-[30px] rounded-lg px-2 text-xs"
        >
          Copy
        </CopyButton>
        <button
          ref={discardRef}
          type="button"
          onClick={onDiscard}
          className="ease-quick h-[30px] shrink-0 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-tint hover:text-foreground"
        >
          Discard
        </button>
        <button
          ref={sendRef}
          type="button"
          disabled={sendOff}
          onClick={onSend}
          className="ease-quick inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-brand pr-3 pl-2.5 text-xs font-semibold text-brand-on disabled:cursor-default disabled:bg-border disabled:text-muted-foreground"
        >
          <Icon kind="send" size={14} />
          Send
        </button>
      </div>
      <JsonLines
        key={JSON.stringify(pending)}
        value={shown}
        folded={foldedAtFirst(pending.dataModel)}
        className="mr-[7px] max-h-32"
      />
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
