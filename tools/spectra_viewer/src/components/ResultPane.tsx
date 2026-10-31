import {Popover} from 'radix-ui';
import {Fragment, useState} from 'react';
import {usePanelRef} from 'react-resizable-panels';

import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {cn} from '@/lib/utils';
import {bindingOf} from '@/model/bindings.ts';
import type {Route} from '@/model/preview.ts';
import type {ComponentNode, Replay, SurfaceView, TreeNode} from '@/model/replay.ts';
import {rememberedSize, rememberSize} from '@/state/layout.ts';
import {setViewSetting, useViewSettings} from '@/state/view_settings.ts';

import {Icon} from './icons.tsx';
import {JsonBlock} from './JsonBlock.tsx';
import {NARROW, PreviewPane, WidthSwitch} from './PreviewPane.tsx';
import {ProblemMark} from './TurnList.tsx';

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
 * step selected.
 */
export function ResultPane({
  reply,
  asOf,
  replay,
  surface,
  onPick,
  preview,
  problemsBySurface,
  open,
  sentA2ui,
  failed,
  later = false,
  folded = false,
}: {
  reply: string;
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
  later?: boolean;
  /** Folded to its header line, while the step's detail is maximized. */
  folded?: boolean;
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
  return (
    <section aria-label="Result" className="flex h-full min-h-0 flex-col">
      {reply !== '' && !folded && (
        <div className="mx-4 mt-3 flex shrink-0 items-start gap-2.5 rounded-[10px] bg-tint px-3 py-2.5">
          <Icon kind="text" size={14} className="mt-0.5 text-muted-foreground" />
          <p className="min-w-0 flex-1">{reply}</p>
        </div>
      )}
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
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
                'ease-quick cursor-pointer px-0.5 text-sm',
                toggle.on
                  ? 'font-semibold text-foreground shadow-[inset_0_-2px_0_var(--brand)]'
                  : 'font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              {toggle.label}
            </button>
          ))}
        </div>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{asOf}</span>
        <div className="flex-1" />
        {drawn !== undefined && (
          <>
            <span
              title={drawn.label === 'built-in' ? 'Spectra’s built-in preview page' : drawn.label}
              className="max-w-[220px] min-w-0 truncate text-xs text-muted-foreground"
            >
              {drawn.label}
            </span>
            <WidthSwitch width={settings.width} />
          </>
        )}
        {surface !== undefined && (
          <SurfaceSwitcher
            replay={replay!}
            current={surface}
            problemsBySurface={problemsBySurface}
            onPick={onPick}
          />
        )}
      </div>
      {/* Folded, the panes unmount, so the preview's iframe, laid over its frame, hides too. */}
      {folded ? null : replay === undefined ? (
        <Centered>Reading the conversation’s earlier turns…</Centered>
      ) : surface === undefined ? (
        <Centered icon>
          {open
            ? 'No surfaces yet.'
            : later
              ? 'No surfaces yet at this step.'
              : replay.deleted.length > 0
                ? 'No surfaces: the turn deleted every surface it had.'
                : sentA2ui
                  ? 'No surfaces: the agent sent no A2UI that builds one.'
                  : failed
                    ? 'No surfaces: the turn failed before any A2UI arrived.'
                    : 'No surfaces: the agent sent no A2UI in this turn.'}
        </Centered>
      ) : (
        <Panes
          surface={surface}
          open={open}
          preview={showPreview ? preview : undefined}
          showStructure={showStructure}
          width={settings.width}
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
}: {
  surface: SurfaceView;
  open: boolean;
  /** None while the Preview pane is hidden. */
  preview: PreviewView | undefined;
  showStructure: boolean;
  width: 'narrow' | 'wide';
}) {
  const previewPanel = usePanelRef();
  const structure = <Structure key={surface.surfaceId} surface={surface} open={open} />;
  const drawing = preview === undefined ? undefined : <PreviewPane {...preview} width={width} />;
  if (drawing === undefined) return structure;
  if (!showStructure) return <div className="flex min-h-0 flex-1">{drawing}</div>;
  const divider = width === 'narrow' ? 'previewNarrow' : 'previewWide';
  return (
    <ResizablePanelGroup
      // A new width starts from its own divider position.
      key={width}
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
        minSize={240}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div className="flex h-full min-h-0">{drawing}</div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize={240}>{structure}</ResizablePanel>
    </ResizablePanelGroup>
  );
}

function Centered({children, icon = false}: {children: string; icon?: boolean}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      {icon && <Icon kind="createSurface" size={22} />}
      <p className="max-w-[360px]">{children}</p>
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
          className="ease-quick inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 text-xs whitespace-nowrap hover:bg-tint"
        >
          <span className="text-muted-foreground">Surface</span>
          <span className="font-semibold">{current.surfaceId}</span>
          <ProblemMark count={problemsBySurface.get(current.surfaceId) ?? 0} size={12} />
          <Icon kind="chevronDown" size={13} className="text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="fade-in-quick z-50 flex w-[420px] flex-col gap-0.5 rounded-[10px] bg-panel p-1.5 text-sm shadow-float"
        >
          <div role="listbox" aria-label="Surfaces" className="flex flex-col gap-0.5">
            {groups.map(group => (
              <Fragment key={group.label}>
                <div className="section-label px-2 pt-2 pb-1">{group.label}</div>
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
                        selected
                          ? 'bg-brand-soft shadow-[inset_2px_0_0_var(--brand)]'
                          : 'hover:bg-tint',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon kind="createSurface" size={13} className="text-muted-foreground" />
                        <span
                          className={cn('truncate', selected ? 'font-semibold' : 'font-medium')}
                        >
                          {view.surfaceId}
                        </span>
                        <ProblemMark count={problemsBySurface.get(view.surfaceId) ?? 0} size={12} />
                      </span>
                      <span className="truncate pl-[19px] text-xs text-muted-foreground">
                        {view.catalogId ?? 'No catalog named'}
                      </span>
                    </button>
                  );
                })}
              </Fragment>
            ))}
            {replay.deleted.length > 0 && (
              <>
                <div className="section-label px-2 pt-2 pb-1">Deleted in this turn</div>
                {replay.deleted.map(surfaceId => (
                  <div
                    key={surfaceId}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground"
                  >
                    <Icon kind="deleteSurface" size={13} />
                    <span className="truncate font-medium">{surfaceId}</span>
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

/** A surface's tree above its data model. */
function Structure({surface, open}: {surface: SurfaceView; open: boolean}) {
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
        <div className="section-label mb-1.5">Tree</div>
        {surface.rejectedUpdates !== undefined ? (
          <p className="my-2 text-muted-foreground">
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
            />
          )
        )}
        {sections.map(section => (
          <Fragment key={section.label}>
            <div className="section-label mt-3.5 mb-1.5">{section.label}</div>
            {section.nodes.map(node => (
              <TreeRows
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                open={open}
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
            <div className="section-label mb-1.5">Data model</div>
            <p className="my-2 text-muted-foreground">Empty.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** A node's row, its properties when opened, then its children. */
function TreeRows({
  node,
  depth,
  expanded,
  onToggle,
  open,
}: {
  node: TreeNode;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  open: boolean;
}) {
  const pad = {paddingLeft: depth * 16};
  if ('missing' in node) {
    return (
      <div
        style={pad}
        className="flex h-[26px] items-center gap-1.5 whitespace-nowrap text-muted-foreground"
      >
        <span className="w-3.5 shrink-0" />
        <span>#{node.id}</span>
        <span className="flex-1" />
        <span className="text-xs">{open ? 'not received yet' : 'no component has this id'}</span>
      </div>
    );
  }
  const key = `${depth}:${node.id}`;
  const isOpen = expanded.has(key);
  const properties = propertiesOf(node);
  return (
    <>
      <div style={pad} className="flex h-[26px] items-center gap-1.5 whitespace-nowrap">
        <button
          type="button"
          aria-label={`Show the properties of #${node.id}`}
          aria-expanded={isOpen}
          onClick={() => onToggle(key)}
          className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <Icon kind={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
        </button>
        <span className="font-medium">{node.type}</span>
        <span className="text-muted-foreground">#{node.id}</span>
        <span className="flex-1" />
        <span className="truncate text-xs text-muted-foreground">{bindingOf(node.properties)}</span>
      </div>
      {isOpen && (
        <div
          style={{marginLeft: depth * 16 + 20}}
          className="mb-1.5 flex flex-col gap-0.5 rounded-lg bg-tint px-2.5 py-1.5 text-xs"
        >
          {properties.length === 0 && <span className="text-muted-foreground">No properties.</span>}
          {properties.map(([name, value]) => (
            <div key={name} className="flex min-w-0 gap-2.5 leading-5">
              <span className="w-[84px] shrink-0 text-muted-foreground">{name}</span>
              <span className="min-w-0 font-mono break-all whitespace-pre-wrap">
                {JSON.stringify(value)}
              </span>
            </div>
          ))}
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
        />
      ))}
    </>
  );
}

/** A component's properties, but for the id and the type the row already shows. */
function propertiesOf(node: ComponentNode): Array<[string, unknown]> {
  return Object.entries(node.properties).filter(([name]) => name !== 'id' && name !== 'component');
}
