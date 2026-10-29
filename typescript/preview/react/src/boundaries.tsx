/**
 * Every catalog component in a boundary of its own, so one that throws is
 * reported with its id and type and leaves the rest of the surface drawn. A
 * React implementation gets an error boundary around its view; a web
 * component, such as web core's universal elements, which both basic
 * catalogs are drawn with, is guarded at its updates by the core.
 */
import type {ReactCatalogComponent} from '@a2ui/react/v0_9';
import type {Catalog} from '@a2ui/web_core/v0_9';
import type {PageEvents} from 'a2ui-spectra-preview';
import {identityOf} from 'a2ui-spectra-preview/web-core';
import {Component, type FC, type ReactNode} from 'react';

/** The component a failure belongs to. */
interface Identity {
  componentId?: string;
  componentType?: string;
}

type Report = PageEvents['componentFailed'];

/** Where the boundaries report: the current processor's events, replaced as each is made. */
let reportTo: Report | undefined;

export function reportFailuresTo(report: Report | undefined): void {
  reportTo = report;
}

class ComponentBoundary extends Component<Identity & {children: ReactNode}, {failed: boolean}> {
  override state = {failed: false};

  static getDerivedStateFromError(): {failed: boolean} {
    return {failed: true};
  }

  override componentDidCatch(error: unknown): void {
    const {componentId, componentType} = this.props;
    reportTo?.({
      ...(componentId !== undefined && {componentId}),
      ...(componentType !== undefined && {componentType}),
      error,
    });
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function withBoundary<Props extends object>(
  Inner: FC<Props>,
  identify: (props: Props) => Identity,
): FC<Props> {
  const Guarded: FC<Props> = props => (
    <ComponentBoundary {...identify(props)}>
      <Inner {...props} />
    </ComponentBoundary>
  );
  Guarded.displayName = `Guarded(${Inner.displayName ?? Inner.name ?? 'Component'})`;
  return Guarded;
}

const guarded = new WeakSet<object>();

/**
 * Puts each React implementation of a catalog in an error boundary, once per
 * catalog, in place, as upstream's renderer prepares the catalogs it is given.
 */
export function guardCatalog(catalog: Catalog<ReactCatalogComponent>): void {
  if (guarded.has(catalog)) return;
  guarded.add(catalog);
  const components = catalog.components as Map<string, ReactCatalogComponent>;
  for (const [name, implementation] of components) {
    if (!('render' in implementation)) continue;
    const {render, view} = implementation;
    components.set(name, {
      ...implementation,
      render: withBoundary(render, props => identityOf(props.context.componentModel)),
      ...(view !== undefined && {
        view: withBoundary(view, props =>
          identityOf({id: props.node.componentId, type: props.node.type}),
        ),
      }),
    });
  }
}
