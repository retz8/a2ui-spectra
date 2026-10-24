import {ChevronDownIcon, ChevronRightIcon} from 'lucide-react';
import {useState} from 'react';

import {Badge} from '@/components/ui/badge.tsx';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible.tsx';
import type {Replay, SurfaceStructure, SurfaceView, TreeNode} from '@/model/replay.ts';

import {JsonView} from './JsonView.tsx';
import {type GoTo, targetIds} from './links.ts';
import {Labelled} from './WireEvents.tsx';

/** The conversation's surfaces after the turn: the processor's rejections first, then each surface. */
export function SurfacesTab({replay, goTo}: {replay: Replay | undefined; goTo: GoTo}) {
  if (replay === undefined) {
    return (
      <p className="text-sm text-muted-foreground">Reading the conversation's earlier turns…</p>
    );
  }
  const {rejections, surfaces, deleted} = replay;
  if (rejections.length === 0 && surfaces.length === 0 && deleted.length === 0) {
    return <p className="text-sm text-muted-foreground">No surfaces in this conversation yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {rejections.length > 0 && (
        <section className="rounded-lg border p-3">
          <h3 className="mb-2 text-sm font-semibold">Rejected by the processor</h3>
          <ul className="flex flex-col gap-2">
            {rejections.map(rejection => (
              <li
                key={rejection.key}
                id={targetIds.rejection(rejection.key)}
                className="scroll-mt-4 rounded-md p-1 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {rejection.code}
                  </Badge>
                  {rejection.surfaceId !== undefined && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {rejection.surfaceId}
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-xs underline-offset-2 hover:underline"
                    onClick={() => goTo('raw', targetIds.message(rejection.key))}
                  >
                    the message
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{rejection.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {surfaces.map(surface => (
        <Surface key={surface.surfaceId} surface={surface} />
      ))}
      {deleted.map(surfaceId => (
        <p key={surfaceId} className="rounded-lg border px-3 py-2 text-sm">
          <span className="font-mono">{surfaceId}</span>{' '}
          <span className="text-muted-foreground">deleted in this turn</span>
        </p>
      ))}
    </div>
  );
}

function Surface({surface}: {surface: SurfaceView}) {
  const [open, setOpen] = useState(surface.touched);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Chevron className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm font-semibold">{surface.surfaceId}</span>
        {!surface.touched && (
          <span className="text-xs text-muted-foreground">not changed in this turn</span>
        )}
        {surface.catalogId !== undefined && (
          <span
            className="ml-auto truncate text-xs text-muted-foreground"
            title={surface.catalogId}
          >
            {surface.catalogId}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 border-t p-3">
        <Structure structure={surface.structure} />
        <Labelled label="Data model">
          <JsonView value={surface.dataModel} depth={2} />
        </Labelled>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Structure({structure}: {structure: SurfaceStructure}) {
  if ('unnested' in structure) {
    return (
      <Labelled label="Components, nested once the catalog's schemas are known">
        {structure.unnested.map(node => (
          <ComponentTree key={node.id} node={node} />
        ))}
      </Labelled>
    );
  }
  return (
    <>
      <Labelled label="Tree">
        <ComponentTree node={structure.tree} />
      </Labelled>
      {structure.notUnderRoot.length > 0 && (
        <Labelled label="Not under the root">
          {structure.notUnderRoot.map(node => (
            <ComponentTree key={node.id} node={node} />
          ))}
        </Labelled>
      )}
    </>
  );
}

function ComponentTree({node}: {node: TreeNode}) {
  const [open, setOpen] = useState(false);
  if ('missing' in node) {
    return (
      <div className="py-0.5 text-sm">
        <span className="font-mono text-muted-foreground">{node.id}</span>{' '}
        <span className="text-xs text-muted-foreground italic">no component has this id</span>
      </div>
    );
  }
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="text-sm">
      <button
        type="button"
        className="flex items-center gap-1 rounded py-0.5 hover:bg-accent"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{node.type}</span>
        <span className="font-mono text-xs text-muted-foreground">#{node.id}</span>
      </button>
      {open && (
        <div className="mb-1 ml-5">
          <JsonView value={node.properties} />
        </div>
      )}
      {node.children.length > 0 && (
        <div className="ml-2 border-l pl-3">
          {node.children.map((child, index) => (
            <ComponentTree key={`${child.id}-${index}`} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}
