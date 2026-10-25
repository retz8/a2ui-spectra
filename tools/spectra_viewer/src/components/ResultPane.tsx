import {Popover} from 'radix-ui';
import {Fragment, useState} from 'react';

import {cn} from '@/lib/utils';
import {bindingOf} from '@/model/bindings.ts';
import type {ComponentNode, Replay, SurfaceView, TreeNode} from '@/model/replay.ts';

import {Icon} from './icons.tsx';
import {JsonBlock} from './JsonBlock.tsx';
import {ProblemMark} from './TurnList.tsx';

/**
 * The result: the agent's reply text in a strip, then the Structure tab with
 * the surface switcher, showing the surfaces as they stood after the step
 * selected.
 */
export function ResultPane({
  reply,
  asOf,
  replay,
  problemsBySurface,
  open,
}: {
  reply: string;
  asOf: string;
  /** None until the conversation's earlier turns have been read. */
  replay: Replay | undefined;
  problemsBySurface: ReadonlyMap<string, number>;
  /** Whether the turn is still open, so what is missing may yet come. */
  open: boolean;
}) {
  const [picked, setPicked] = useState<string | undefined>();
  const surfaces = replay?.surfaces ?? [];
  const surface = surfaces.find(view => view.surfaceId === picked) ?? surfaces[0];
  return (
    <section aria-label="Result" className="flex h-full min-h-0 flex-col">
      {reply !== '' && (
        <div className="mx-4 mt-3 flex shrink-0 items-start gap-2.5 rounded-[10px] bg-tint px-3 py-2.5">
          <Icon kind="text" size={14} className="mt-0.5 text-muted-foreground" />
          <p className="min-w-0 flex-1">{reply}</p>
        </div>
      )}
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <div role="tablist" aria-label="Result views" className="flex gap-4 self-stretch">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="px-0.5 text-sm font-semibold shadow-[inset_0_-2px_0_var(--brand)]"
          >
            Structure
          </button>
        </div>
        <span className="text-xs text-muted-foreground">{asOf}</span>
        <div className="flex-1" />
        {surface !== undefined && (
          <SurfaceSwitcher
            replay={replay!}
            current={surface}
            problemsBySurface={problemsBySurface}
            onPick={setPicked}
          />
        )}
      </div>
      {replay === undefined ? (
        <Centered>Reading the conversation’s earlier turns…</Centered>
      ) : surface === undefined ? (
        <Centered icon>
          {open
            ? 'No surfaces yet.'
            : replay.deleted.length > 0
              ? 'No surfaces: the turn deleted every surface it had.'
              : 'No surfaces: the agent sent no A2UI that builds one.'}
        </Centered>
      ) : (
        <Structure key={surface.surfaceId} surface={surface} open={open} />
      )}
    </section>
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
          className="ease-quick inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 text-xs hover:bg-tint"
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

/** A surface's tree and its data model, side by side. */
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
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 basis-1/2 overflow-auto border-r px-4 py-3">
        <div className="section-label mb-1.5">Tree</div>
        {'tree' in structure && (
          <TreeRows
            node={structure.tree}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            open={open}
          />
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
      <div className="min-w-0 flex-1 basis-1/2 overflow-auto px-4 py-3">
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
