import {Popover} from 'radix-ui';
import {Fragment, useEffect, useState} from 'react';
import {usePanelRef} from 'react-resizable-panels';

import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {cn} from '@/lib/utils';
import {noSurfaceSentenceOf} from '@/model/as_of.ts';
import {bindingOf} from '@/model/bindings.ts';
import {legacyKeysOfNode} from '@/model/legacy_form.ts';
import {pageNoteOf, type Route} from '@/model/preview.ts';
import type {ComponentNode, Replay, SurfaceView, TreeNode} from '@/model/replay.ts';
import type {Reply} from '@/model/steps.ts';
import {rememberedSize, rememberSize} from '@/state/layout.ts';
import {useSelectedNode} from '@/state/selected_node.ts';
import {setViewSetting, useViewSettings} from '@/state/view_settings.ts';

import {Icon, LegacyMark, ProblemMark} from './icons.tsx';
import {JsonBlock} from './JsonBlock.tsx';
import {NARROW, PreviewPane, WidthSwitch} from './PreviewPane.tsx';

/** The Preview pane's width beside Structure at Narrow: the frame and the canvas's padding around it. */
const PREVIEW_AT_NARROW = NARROW + 32;

/** The preview of the surface in view: where it is routed, and what its page reported. */
export interface PreviewView {
  route: Route;
  lines: readonly string[];
}

/**
 * The result: the agent's reply text in a strip, then the Preview and
 * Structure panes side by side, each shown or hidden by its toggle, with
 * the surface switcher, showing the surface picked as it stood after the
 * step selected. A reply a failed parse read is muted behind a tag that
 * selects that parse.
 */
export function ResultPane({
  replies,
  onReplyParse,
  asOf,
  replay,
  surface,
  onPick,
  preview,
  problemsBySurface,
  open,
  sentA2ui,
  failed,
  later,
  folded,
  legacyKeys,
}: {
  /** The agent's replies up to the step, a line each. */
  replies: readonly Reply[];
  /** Selects the failed parse a reply's tag names, by its span id. */
  onReplyParse: (parseSpanId: string) => void;
  asOf: string;
  /** None until the conversation's earlier turns have been read. */
  replay: Replay | undefined;
  /** The surface in view, picked in the switcher or the first. */
  surface: SurfaceView | undefined;
  onPick: (surfaceId: string) => void;
  /** None until a surface is in view. */
  preview: PreviewView | undefined;
  problemsBySurface: ReadonlyMap<string, number>;
  /** Whether the turn is still open, so what is missing may yet come. */
  open: boolean;
  /** Whether the agent sent any A2UI in the turn. */
  sentA2ui: boolean;
  failed: boolean;
  /** Whether the turn has surfaces after the step in view, none of which stood yet at it. */
  later: boolean;
  /** Folded to its header line, while the step's detail is maximized. */
  folded: boolean;
  /** The bare keys of each component object the turn's messages carried in the legacy form, by its pointer from the turn. */
  legacyKeys: ReadonlyMap<string, string[]>;
}) {
  const settings = useViewSettings();
  // At least one pane shows: Structure when both are toggled off.
  const showPreview = settings.preview;
  const showStructure = settings.structure || !settings.preview;
  const toggles = [
    {label: 'Preview', on: showPreview, key: 'preview' as const, other: showStructure},
    {label: 'Structure', on: showStructure, key: 'structure' as const, other: showPreview},
  ];
  const drawn = showPreview && preview?.route.kind === 'page' ? preview.route.page : undefined;
  const note = drawn === undefined ? undefined : pageNoteOf(drawn);
  return (
    <section aria-label="Result" className="flex h-full min-h-0 flex-col">
      {replies.length > 0 && !folded && (
        <div className="mx-4 mt-3 flex shrink-0 items-start gap-2.5 rounded-lg bg-tint px-3 py-2.5">
          <Icon kind="text" size={14} className="mt-0.5 shrink-0 tone-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {replies.map(({text, failedParse}, index) => (
              <p
                // The replies only grow, each staying where it was.
                key={index}
                className={cn(
                  'type-body flex items-start gap-2',
                  failedParse !== undefined && 'tone-muted',
                )}
              >
                {failedParse !== undefined && (
                  <button
                    type="button"
                    onClick={() => onReplyParse(failedParse)}
                    className="ease-quick type-meta inline-flex h-5 shrink-0 cursor-pointer items-center rounded-sm bg-panel px-1.5 whitespace-nowrap hover:tone-foreground"
                  >
                    Failed to parse
                  </button>
                )}
                <span className="min-w-0">{text}</span>
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="flex shrink-0 flex-col">
        {/* Folded, the divider under the pane is the tab row's line. */}
        <div
          className={cn(
            'flex h-11 items-center gap-3 px-4',
            !folded && 'shadow-[inset_0_-1px_0_var(--border)]',
          )}
        >
          <div role="group" aria-label="Result panes" className="flex gap-4 self-stretch">
            {toggles.map(toggle => (
              <button
                key={toggle.key}
                type="button"
                aria-pressed={toggle.on}
                // The only pane shown stays: hiding it would leave none.
                onClick={() => {
                  if (!toggle.on || toggle.other) setViewSetting(toggle.key, !toggle.on);
                }}
                className={cn(
                  'ease-quick type-tab cursor-pointer px-0.5',
                  toggle.on && 'shadow-mark-bottom',
                )}
              >
                {toggle.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {drawn !== undefined && <WidthSwitch width={settings.width} />}
          {surface !== undefined && replay !== undefined && (
            <SurfaceSwitcher
              replay={replay}
              current={surface}
              problemsBySurface={problemsBySurface}
              onPick={onPick}
            />
          )}
        </div>
        {(asOf !== '' || drawn !== undefined) && (
          <div className="type-meta flex min-w-0 items-center gap-1.5 overflow-hidden border-b px-4 py-1.5 whitespace-nowrap">
            {asOf !== '' && <span className="min-w-0 truncate">{asOf}</span>}
            {drawn !== undefined && (
              <>
                {asOf !== '' && <span className="shrink-0">·</span>}
                {note?.reloading === true && <Icon kind="open" size={12} className="shrink-0" />}
                <span
                  role="status"
                  title={
                    drawn.label === 'built-in' ? 'Spectra’s built-in preview page' : drawn.label
                  }
                  className="min-w-0 truncate"
                >
                  {note?.text}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      {/* Folded, the panes unmount, so the preview's iframe, laid over its frame, hides too. */}
      {folded ? null : replay === undefined ? (
        <Centered>Reading the conversation’s earlier turns…</Centered>
      ) : surface === undefined ? (
        <Centered icon>
          {noSurfaceSentenceOf({open, later, deleted: replay.deleted.length > 0, sentA2ui, failed})}
        </Centered>
      ) : (
        <Panes
          surface={surface}
          open={open}
          preview={showPreview ? preview : undefined}
          showStructure={showStructure}
          width={settings.width}
          legacyKeys={legacyKeys}
        />
      )}
    </section>
  );
}

/** The Preview and Structure panes, side by side with a divider when both show. */
function Panes({
  surface,
  open,
  preview,
  showStructure,
  width,
  legacyKeys,
}: {
  surface: SurfaceView;
  open: boolean;
  /** None while the Preview pane is hidden. */
  preview: PreviewView | undefined;
  showStructure: boolean;
  width: 'narrow' | 'wide';
  legacyKeys: ReadonlyMap<string, string[]>;
}) {
  const previewPanel = usePanelRef();
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const groupWidth = useWidthOf(group);
  const structure = (
    <Structure key={surface.surfaceId} surface={surface} open={open} legacyKeys={legacyKeys} />
  );
  const drawing = preview === undefined ? undefined : <PreviewPane {...preview} width={width} />;
  if (drawing === undefined) return structure;
  if (!showStructure) return <div className="flex min-h-0 flex-1">{drawing}</div>;
  const divider = width === 'narrow' ? 'previewNarrow' : 'previewWide';
  return (
    <ResizablePanelGroup
      // A new width starts from its own divider position.
      key={width}
      elementRef={setGroup}
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChanged={(_, {isUserInteraction}) => {
        const panel = previewPanel.current;
        if (isUserInteraction && panel !== null) rememberSize(divider, panel.getSize().inPixels);
      }}
    >
      <ResizablePanel
        panelRef={previewPanel}
        defaultSize={rememberedSize(divider) ?? (width === 'narrow' ? PREVIEW_AT_NARROW : '50')}
        minSize={width === 'narrow' ? PANE_LEAST : wideLeast(groupWidth)}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div className="flex h-full min-h-0">{drawing}</div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize={PANE_LEAST}>{structure}</ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** Each pane's least width beside the other. */
const PANE_LEAST = 240;

/**
 * The Preview pane's least width at Wide, beside Structure: Narrow's pane, so
 * Wide is never the narrower, as far as Structure's least width and the
 * divider leave room for it.
 */
function wideLeast(groupWidth: number | undefined): number {
  if (groupWidth === undefined) return PANE_LEAST;
  return Math.max(PANE_LEAST, Math.min(PREVIEW_AT_NARROW, groupWidth - PANE_LEAST - 1));
}

/** An element's width, kept up to date as it changes; none until it is drawn. */
function useWidthOf(element: HTMLElement | null): number | undefined {
  const [width, setWidth] = useState<number | undefined>();
  useEffect(() => {
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return width;
}

function Centered({children, icon = false}: {children: string; icon?: boolean}) {
  return (
    <div className="type-quiet flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {icon && <Icon kind="createSurface" size={24} className="tone-muted" />}
      <p className="max-w-90">{children}</p>
    </div>
  );
}

/** The surfaces the turn touched first, then those it did not change, and those it deleted. */
function SurfaceSwitcher({
  replay,
  current,
  problemsBySurface,
  onPick,
}: {
  replay: Replay;
  current: SurfaceView;
  problemsBySurface: ReadonlyMap<string, number>;
  onPick: (surfaceId: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const groups = [
    {label: 'Touched in this turn', surfaces: replay.surfaces.filter(view => view.touched)},
    {label: 'Not changed in this turn', surfaces: replay.surfaces.filter(view => !view.touched)},
  ].filter(group => group.surfaces.length > 0);
  return (
    <Popover.Root open={shown} onOpenChange={setShown}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="ease-quick type-control inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 whitespace-nowrap hover:bg-tint"
        >
          <span className="type-meta">Surface</span>
          <span>{current.surfaceId}</span>
          <ProblemMark count={problemsBySurface.get(current.surfaceId) ?? 0} />
          <Icon kind="chevronDown" size={12} className="tone-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="fade-in-quick z-50 flex w-105 flex-col gap-0.5 rounded-xl bg-panel p-1.5 shadow-float"
        >
          <div role="listbox" aria-label="Surfaces" className="flex flex-col gap-0.5">
            {groups.map(group => (
              <Fragment key={group.label}>
                <div className="type-section-label px-2 pt-2 pb-1">{group.label}</div>
                {group.surfaces.map(view => {
                  const selected = view.surfaceId === current.surfaceId;
                  return (
                    <button
                      key={view.surfaceId}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onPick(view.surfaceId);
                        setShown(false);
                      }}
                      className={cn(
                        'ease-quick flex cursor-pointer flex-col gap-px rounded-lg px-2 py-1.5 text-left',
                        selected ? 'bg-brand-soft shadow-mark-start' : 'hover:bg-tint',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon kind="createSurface" size={14} className="shrink-0 tone-muted" />
                        <span className="type-name truncate">{view.surfaceId}</span>
                        <ProblemMark count={problemsBySurface.get(view.surfaceId) ?? 0} />
                      </span>
                      <span className="type-meta truncate pl-5">
                        {view.catalogId ?? 'No catalog named'}
                      </span>
                    </button>
                  );
                })}
              </Fragment>
            ))}
            {replay.deleted.length > 0 && (
              <>
                <div className="type-section-label px-2 pt-2 pb-1">Deleted in this turn</div>
                {replay.deleted.map(surfaceId => (
                  <div key={surfaceId} className="flex items-center gap-1.5 px-2 py-1.5">
                    <Icon kind="deleteSurface" size={14} className="shrink-0 tone-muted" />
                    <span className="type-name-off truncate">{surfaceId}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A surface's tree above its data model. A node's properties are the
 * component as the message wrote it; a node whose standing object a message
 * of this turn carried in the legacy form carries the hourglass.
 */
function Structure({
  surface,
  open,
  legacyKeys,
}: {
  surface: SurfaceView;
  open: boolean;
  legacyKeys: ReadonlyMap<string, string[]>;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  };
  const {structure} = surface;
  const sections =
    'tree' in structure
      ? structure.notUnderRoot.length > 0
        ? [{label: 'Not under the root', nodes: structure.notUnderRoot}]
        : []
      : [{label: 'Nested once the catalog’s schemas are known', nodes: structure.unnested}];
  const data = surface.dataModel;
  const hasData =
    data !== undefined &&
    data !== null &&
    !(typeof data === 'object' && Object.keys(data as object).length === 0);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-auto">
      <div className="min-w-0 shrink-0 border-b px-4 py-3">
        <div className="type-section-label mb-1.5">Tree</div>
        {surface.rejectedUpdates !== undefined ? (
          <p className="type-quiet">
            {surface.rejectedUpdates === 1
              ? 'No components: this surface’s only updateComponents was rejected.'
              : `No components: each of this surface’s ${surface.rejectedUpdates} updateComponents was rejected.`}
          </p>
        ) : (
          'tree' in structure && (
            <TreeRows
              node={structure.tree}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              open={open}
              surface={surface}
              legacyKeys={legacyKeys}
            />
          )
        )}
        {sections.map(section => (
          <Fragment key={section.label}>
            <div className="type-section-label mt-3.5 mb-1.5">{section.label}</div>
            {section.nodes.map(node => (
              <TreeRows
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                open={open}
                surface={surface}
                legacyKeys={legacyKeys}
              />
            ))}
          </Fragment>
        ))}
      </div>
      <div className="min-w-0 shrink-0 px-4 py-3">
        {hasData ? (
          <JsonBlock label="Data model" value={data} />
        ) : (
          <>
            <div className="type-section-label mb-1.5 flex h-6 items-center">Data model</div>
            <p className="type-quiet">Empty.</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A node's row, its properties when opened, then its children. Clicking the
 * row selects the node, which selects the parse it came from; its chevron
 * still opens its properties. A node in the legacy form carries the
 * hourglass after its id, and its opened properties a quiet line naming its
 * bare keys.
 */
function TreeRows({
  node,
  depth,
  expanded,
  onToggle,
  open,
  surface,
  legacyKeys,
}: {
  node: TreeNode;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  open: boolean;
  surface: SurfaceView;
  legacyKeys: ReadonlyMap<string, string[]>;
}) {
  // The node the page address holds, and how a row selects one: its parse with it.
  const {node: selectedNode, selectInTree} = useSelectedNode();
  const pad = {paddingLeft: depth * 16 + 6};
  if ('missing' in node) {
    return (
      <div style={pad} className="-mx-1.5 flex h-6 items-center gap-1.5 pr-1.5 whitespace-nowrap">
        <span className="w-3.5 shrink-0" />
        <span className="type-meta">#{node.id}</span>
        <span className="flex-1" />
        <span className="type-meta">{open ? 'not received yet' : 'no component has this id'}</span>
      </div>
    );
  }
  const key = `${depth}:${node.id}`;
  const isOpen = expanded.has(key);
  const properties = propertiesOf(surface.written?.get(node.id)?.object ?? node.properties);
  const legacy = legacyKeysOfNode(surface, node.id, legacyKeys);
  const isSelected =
    selectedNode?.surfaceId === surface.surfaceId && selectedNode.componentId === node.id;
  const onSelect = (componentId: string) =>
    selectInTree({surfaceId: surface.surfaceId, componentId});
  return (
    <>
      <div
        style={pad}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onSelect(node.id)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(node.id);
          }
        }}
        className={cn(
          '-mx-1.5 flex h-6 items-center gap-1.5 rounded-md pr-1.5 whitespace-nowrap',
          'cursor-pointer',
          isSelected ? 'bg-brand-soft shadow-mark-start' : 'hover:bg-tint',
        )}
      >
        <button
          type="button"
          aria-label={`Show the properties of #${node.id}`}
          aria-expanded={isOpen}
          onClick={event => {
            event.stopPropagation();
            onToggle(key);
          }}
          className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm tone-muted hover:bg-tint hover:tone-foreground"
        >
          <Icon kind={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
        </button>
        <span className="type-name">{node.type}</span>
        <span className="type-meta">#{node.id}</span>
        {legacy !== undefined && <LegacyMark size={12} />}
        <span className="flex-1" />
        <span className="type-meta truncate">{bindingOf(node.properties)}</span>
      </div>
      {isOpen && (
        <div
          style={{marginLeft: depth * 16 + 20}}
          className="mt-0.5 mb-1.5 grid grid-cols-facts gap-x-3 gap-y-0.5"
        >
          {properties.length === 0 && (
            <span className="type-meta col-span-2 leading-5">No properties.</span>
          )}
          {properties.map(([name, value]) => (
            <Fragment key={name}>
              <span className="type-code-muted min-w-0 leading-5 wrap-anywhere">{name}</span>
              <span className="type-code min-w-0 leading-5 wrap-anywhere whitespace-pre-wrap">
                {JSON.stringify(value)}
              </span>
            </Fragment>
          ))}
          {legacy !== undefined && (
            <div className="type-meta col-span-2 flex min-w-0 items-center gap-1.5 leading-5">
              <Icon kind="legacy" size={12} className="shrink-0" />
              <span>
                Legacy form:{' '}
                {legacy.map((name, index) => (
                  <span key={name}>
                    {index > 0 && ', '}
                    <code className="type-code-inline">{name}</code>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
      {node.children.map(child => (
        <TreeRows
          key={child.id}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          open={open}
          surface={surface}
          legacyKeys={legacyKeys}
        />
      ))}
    </>
  );
}

/** A component's properties, in the order written, but for the id and the type the row already shows. */
function propertiesOf(properties: ComponentNode['properties']): Array<[string, unknown]> {
  return Object.entries(properties).filter(([name]) => name !== 'id' && name !== 'component');
}
