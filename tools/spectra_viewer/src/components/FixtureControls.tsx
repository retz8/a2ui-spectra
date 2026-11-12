/**
 * The fixture side of a turn's header: the fixture line above it, Save as
 * fixture, Re-run live and Replay in its action area, and the replayed or
 * re-run turn's third line.
 * The server is the authority on a refusal; what the controls disable mirrors
 * its rules, and its answer is shown as it is, in the popover, with nothing
 * moved.
 */
import {Popover} from 'radix-ui';
import {type FormEvent, useEffect, useRef, useState} from 'react';

import {ApiError, type ReplaySource} from '@/api.ts';
import {cn} from '@/lib/utils';
import type {Address} from '@/model/address.ts';
import {refusalNoteOf, RERUN_TOOLTIP} from '@/model/dev_loop.ts';
import {
  hasNothingToServe,
  nameProblemOf,
  recordedCostOf,
  replayRowsOf,
  savedTurnsLine,
  slugOf,
} from '@/model/fixtures.ts';
import type {InputBrief} from '@/model/input_brief.ts';
import {sourceAddressOf, sourceName} from '@/model/provenance.ts';
import type {Turn} from '@/model/record.ts';
import {refusalInputOf, type ReplayLine} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

import {CopyButton} from './CopyButton.tsx';
import {Icon} from './icons.tsx';
import {FailureLine, PressButton} from './Refusal.tsx';

const POPOVER = 'fade-in-quick z-50 flex flex-col rounded-xl bg-panel text-foreground shadow-float';

/** "Fixture · find-italian-restaurants.json · 3 turns · recorded $0.031 · saved 2026-11-05 14:02". */
export function FixtureLine({file, parts}: {file: string; parts: readonly string[]}) {
  return (
    <div
      aria-label="The fixture"
      className="mb-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground"
    >
      <span>Fixture</span>
      <span>·</span>
      <CopyButton
        text={file}
        label="Copy the file name"
        className="h-5 font-medium text-foreground hover:bg-transparent"
      >
        {file}
      </CopyButton>
      {parts.map((part, index) => (
        <span key={index} className="contents">
          <span>·</span>
          <span className={index === parts.length - 1 ? 'min-w-0 truncate' : undefined}>
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * The third quiet line of a replayed turn: what it was replayed from, its
 * number, the mode and the verdict; a re-run reads "Re-run of" its source,
 * its number and "live", with no verdict.
 */
export function ReplayedLine({
  line,
  recordedTurn,
  onAddress,
}: {
  line: ReplayLine;
  recordedTurn: string;
  onAddress: (address: Address) => void;
}) {
  const to = sourceAddressOf(line.source, recordedTurn === '' ? undefined : recordedTurn);
  return (
    <div
      aria-label={line.lead}
      className="min-w-0 truncate text-xs whitespace-nowrap text-muted-foreground"
    >
      {line.lead}{' '}
      {to === undefined ? (
        sourceName(line.source)
      ) : (
        <button
          type="button"
          onClick={() => onAddress(to)}
          className="cursor-pointer font-medium text-brand hover:underline"
        >
          {sourceName(line.source)}
        </button>
      )}{' '}
      · {line.where}
      {line.verdict !== undefined && (
        <>
          {' · '}
          <span
            className={cn(
              'font-medium',
              line.verdict === 'passed' ? 'text-success' : 'text-problem',
            )}
          >
            {line.verdict}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Re-run live, between Save as fixture and Replay: one press sends the
 * turn's conversation again up to and including it, every model and tool
 * call live, and the viewer follows the new turns as it follows a replay.
 * Off, its tooltip carries why under its first line; a press the server
 * refuses shows its answer under the button.
 */
export function RerunControl({
  source,
  unwritten,
  onStarted,
}: {
  /** A store turn by its trace id, or a fixture's turn by the fixture's name and its recorded trace id. */
  source: ReplaySource;
  /** Whether the turn's record was not written to the store. */
  unwritten: boolean;
  /** The first re-run turn has opened. */
  onStarted: (traceId: string) => void;
}) {
  const note = refusalNoteOf(refusalInputOf(useSpectra(), unwritten));
  return (
    <PressButton
      label="Re-run live"
      icon={<Icon kind="rerun" size={14} />}
      tooltip={RERUN_TOOLTIP}
      {...(note !== undefined && {note})}
      off={note !== undefined}
      onPress={async () => onStarted(await spectra.rerun(source))}
      refusalLabel="Re-run was refused"
    />
  );
}

/** One Replay button, in the fixture view's header and in a store turn's alike, opening the two modes with their cost. */
export function ReplayControl({
  source,
  turns,
  unwritten,
  onStarted,
}: {
  source: ReplaySource;
  /** Whether the turn's record was not written to the store. */
  unwritten: boolean;
  /** The record's turns: the whole conversation a replay sends, for the cost and the nothing-to-serve rule. */
  turns: readonly Turn[];
  /** The first replayed turn has opened. */
  onStarted: (traceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="ease-quick inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 text-xs font-medium whitespace-nowrap hover:bg-tint data-[state=open]:bg-tint"
        >
          <Icon kind="replay" size={14} className="text-muted-foreground" />
          Replay
          <Icon kind="chevronDown" size={12} className="text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label="Replay"
          className={cn(POPOVER, 'w-94 gap-0.5 p-1.5')}
        >
          <ReplayRows
            source={source}
            turns={turns}
            unwritten={unwritten}
            onStarted={traceId => {
              setOpen(false);
              onStarted(traceId);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ReplayRows({
  source,
  turns,
  unwritten,
  onStarted,
}: {
  source: ReplaySource;
  turns: readonly Turn[];
  unwritten: boolean;
  onStarted: (traceId: string) => void;
}) {
  const state = useSpectra();
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const rows = replayRowsOf({
    nothingToServe: hasNothingToServe(turns),
    ceiling: recordedCostOf(turns, state.prices),
    note: refusalNoteOf(refusalInputOf(state, unwritten)),
  });
  const start = async (mode: (typeof rows)[number]['mode']) => {
    setStarting(true);
    setFailure(undefined);
    try {
      onStarted(await spectra.replay(source, mode));
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
      setStarting(false);
    }
  };
  return (
    <>
      {rows.map(row => (
        <button
          key={row.mode}
          type="button"
          disabled={row.off || starting}
          onClick={() => void start(row.mode)}
          className={cn(
            'ease-quick flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left',
            row.off || starting
              ? 'cursor-default text-muted-foreground'
              : 'cursor-pointer hover:bg-tint',
          )}
        >
          <span className="font-medium">{row.title}</span>
          <span className="text-xs text-muted-foreground">{row.label}</span>
          {row.note !== undefined && (
            <span className="text-xs font-medium text-muted-foreground">{row.note}</span>
          )}
        </button>
      ))}
      {failure !== undefined && <FailureLine text={failure} className="mx-1 mt-1 mb-0.5" />}
    </>
  );
}

/** Save as fixture, in a store turn's header: disabled on an open turn, opening the name prompt. */
export function SaveAsFixture({
  traceId,
  input,
  turns,
  disabled,
  onOpenFixture,
}: {
  traceId: string;
  input: InputBrief | undefined;
  /** How many turns the fixture will hold. */
  turns: number;
  disabled: boolean;
  onOpenFixture: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'ease-quick inline-flex h-7 shrink-0 items-center rounded-lg border bg-panel px-2.5 text-xs font-medium whitespace-nowrap data-[state=open]:bg-tint',
            disabled ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer hover:bg-tint',
          )}
        >
          Save as fixture
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label="Save as fixture"
          className={cn(POPOVER, 'gap-2 p-3')}
        >
          <SavePrompt
            traceId={traceId}
            input={input}
            turns={turns}
            onOpenFixture={name => {
              setOpen(false);
              onOpenFixture(name);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A refusal for the name it was given, as the server answered it. */
interface Refusal {
  name: string;
  line: string;
  offer?: string;
}

/** The name prompt, its content becoming one line once saved. */
function SavePrompt({
  traceId,
  input,
  turns,
  onOpenFixture,
}: {
  traceId: string;
  input: InputBrief | undefined;
  turns: number;
  onOpenFixture: (name: string) => void;
}) {
  const state = useSpectra();
  const [name, setName] = useState(() => slugOf(input));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const [saved, setSaved] = useState<{name: string; path: string} | undefined>();
  // The form leaves with the field that had focus: the saved line takes it, so Tab reaches Open.
  const savedLine = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (saved !== undefined) savedLine.current?.querySelector('button')?.focus();
  }, [saved]);
  const taken = state.fixtures.listed.map(fixture => fixture.name);
  const problem = refusal?.name === name ? refusal : nameProblemOf(name, taken);
  const off = name === '' || problem !== undefined || saving;
  const folder = state.context?.fixturesFolder ?? state.fixtures.folder ?? '';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (off) return;
    setSaving(true);
    setFailure(undefined);
    try {
      setSaved(await spectra.saveFixture(traceId, name));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (caught instanceof ApiError && caught.status === 409 && caught.suggested !== undefined) {
        setRefusal({name, line: message, offer: caught.suggested});
      } else if (caught instanceof ApiError && caught.status === 400) {
        setRefusal({name, line: message});
      } else {
        setFailure(message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (saved !== undefined) {
    return (
      <div
        ref={savedLine}
        className="flex w-114 min-w-0 items-center gap-1.5 text-xs whitespace-nowrap"
      >
        <span className="shrink-0 text-muted-foreground">Saved as</span>
        <CopyButton
          text={saved.path}
          label="Copy the path"
          className="h-5 min-w-0 font-medium text-foreground hover:bg-transparent"
        >
          <span className="min-w-0 truncate">{saved.path}</span>
        </CopyButton>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onOpenFixture(saved.name)}
          className="shrink-0 cursor-pointer font-semibold text-brand hover:underline"
        >
          Open
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={event => void save(event)} className="flex w-89 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <label
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center rounded-lg border bg-panel px-2.5',
            problem === undefined
              ? 'border-brand ring-3 ring-brand-soft'
              : 'border-muted-foreground',
          )}
        >
          <input
            type="text"
            aria-label="The fixture’s name"
            value={name}
            onChange={event => {
              setName(event.target.value);
              setFailure(undefined);
            }}
            onFocus={event => event.target.select()}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <span className="shrink-0 text-muted-foreground">.json</span>
        <button
          type="submit"
          disabled={off}
          className="ease-quick ml-0.5 h-8 shrink-0 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-brand-on disabled:cursor-default disabled:bg-border disabled:text-muted-foreground"
        >
          Save
        </button>
      </div>
      <span className="text-xs leading-4 text-muted-foreground">{folder}/</span>
      {problem !== undefined && (
        <span className="text-xs leading-4 text-muted-strong">
          {problem.line}
          {problem.offer !== undefined && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => setName(problem.offer!)}
                className="cursor-pointer font-semibold text-brand hover:underline"
              >
                Use {problem.offer}
              </button>
            </>
          )}
        </span>
      )}
      {failure !== undefined && <FailureLine text={failure} />}
      <span className="text-xs leading-4 text-muted-foreground">{savedTurnsLine(turns)}</span>
    </form>
  );
}
