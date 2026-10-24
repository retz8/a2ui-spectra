import {SendIcon} from 'lucide-react';
import {useEffect, useRef, useState, type FormEvent, type KeyboardEvent} from 'react';

import {Button} from '@/components/ui/button.tsx';
import {Spinner} from '@/components/ui/spinner.tsx';
import {Textarea} from '@/components/ui/textarea.tsx';
import type {ChatEntry} from '@/model/chat.ts';
import {boxChatOf, useNeededRecords} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

import {shortId} from './format.ts';

/** Spectra's message box: its conversation as a chat, and the input that continues it. */
export function MessageBoxPanel({onOpenTurn}: {onOpenTurn: (traceId: string) => void}) {
  const state = useSpectra();
  const needs: string[] = [];
  const {entries, loading} = boxChatOf(state, needs);
  useNeededRecords(needs);
  const {box, connected} = state;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const lastEntry = entries[entries.length - 1];
  const lastSize = lastEntry === undefined ? 0 : lastEntry.replies.length + lastEntry.a2uiMessages;

  useEffect(() => end.current?.scrollIntoView({block: 'end'}), [entries.length, lastSize]);

  const turnOpen = box.openTurn !== undefined;
  const disabledReason =
    connected === false
      ? 'Not connected to Spectra'
      : turnOpen
        ? 'waiting for the turn to close'
        : undefined;

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '' || disabledReason !== undefined || sending) return;
    setSending(true);
    setError(undefined);
    try {
      const traceId = await spectra.send(text);
      setText('');
      onOpenTurn(traceId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      void send();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="text-sm font-semibold">Message box</h2>
        {box.conversationId !== undefined && (
          <span
            className="truncate font-mono text-xs text-muted-foreground"
            title={box.conversationId}
          >
            {shortId(box.conversationId)}
          </span>
        )}
        <Button
          variant="outline"
          size="xs"
          className="ml-auto"
          disabled={connected === false}
          onClick={() => {
            setError(undefined);
            spectra
              .newConversation()
              .catch((caught: unknown) =>
                setError(caught instanceof Error ? caught.message : String(caught)),
              );
          }}
        >
          New conversation
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {loading ? 'Reading the conversation…' : 'Send a message to the agent.'}
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {entries.map(entry => (
            <li key={entry.traceId}>
              <ChatTurn entry={entry} onOpenTurn={onOpenTurn} />
            </li>
          ))}
        </ol>
        <div ref={end} />
      </div>
      <div className="shrink-0 border-t p-3">
        {box.unavailable !== undefined ? (
          <p className="text-sm text-muted-foreground">{box.unavailable}</p>
        ) : (
          <form onSubmit={event => void send(event)} className="flex flex-col gap-2">
            <Textarea
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={disabledReason ?? 'Message the agent'}
              disabled={disabledReason !== undefined}
              rows={3}
              className="resize-none"
            />
            <div className="flex items-center gap-2">
              {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="submit"
                size="sm"
                className="ml-auto"
                disabled={disabledReason !== undefined || sending || text.trim() === ''}
              >
                <SendIcon />
                Send
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ChatTurn({entry, onOpenTurn}: {entry: ChatEntry; onOpenTurn: (traceId: string) => void}) {
  return (
    <div className="flex flex-col gap-1.5">
      {entry.sent !== '' && (
        <p className="ml-8 self-end rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {entry.sent}
        </p>
      )}
      {entry.replies.map((reply, index) => (
        <p
          key={index}
          className="mr-8 self-start rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
        >
          {reply}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {entry.a2uiMessages > 0 && (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => onOpenTurn(entry.traceId)}
          >
            {entry.a2uiMessages} A2UI {entry.a2uiMessages === 1 ? 'message' : 'messages'}
          </button>
        )}
        {entry.open && (
          <span className="flex items-center gap-1 text-sky-700 dark:text-sky-400">
            <Spinner className="size-3.5" />
            open
          </span>
        )}
        {entry.outcome === 'waiting_for_input' && (
          <span className="text-amber-700 dark:text-amber-400">
            waiting for input: the next message continues the task
          </span>
        )}
        {entry.outcome === 'failed' && (
          <span className="text-destructive">
            failed{entry.reason !== undefined && `: ${entry.reason}`}
          </span>
        )}
        {entry.outcome === 'cancelled' && <span className="text-muted-foreground">cancelled</span>}
      </div>
    </div>
  );
}
