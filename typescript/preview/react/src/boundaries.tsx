/**
 * Every catalog component in a boundary of its own, so one that throws is
 * reported with its id and type and leaves the rest of the surface drawn. A
 * React implementation gets an error boundary around its view, in a copy of
 * the page's catalog; a web component, such as web core's universal
 * elements, which both basic catalogs are drawn with, is guarded at its
 * updates by the core.
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

class ComponentBoundary extends Component<
  Identity & {report: Report; children: ReactNode},
  {failed: boolean}
> {
  override state = {failed: false};

  static getDerivedStateFromError(): {failed: boolean} {
    return {failed: true};
  }

  override componentDidCatch(error: unknown): void {
    const {componentId, componentType, report} = this.props;
    report({componentId, componentType, error});
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function withBoundary<Props extends object>(
  Inner: FC<Props>,
  identify: (props: Props) => Identity,
  report: Report,
): FC<Props> {
  const Guarded: FC<Props> = props => (
    <ComponentBoundary {...identify(props)} report={report}>
      <Inner {...props} />
    </ComponentBoundary>
  );
  Guarded.displayName = `Guarded(${Inner.displayName ?? Inner.name ?? 'Component'})`;
  return Guarded;
}

/**
 * A copy of a page's catalog with each React implementation in an error
 * boundary, which reports a component that throws to the report given. The
 * page's own catalog is left as it was.
 */
export function guardedCopyOf(
  catalog: Catalog<ReactCatalogComponent>,
  report: Report,
): Catalog<ReactCatalogComponent> {
  const components = [...catalog.components.values()].map(implementation => {
    if (!('render' in implementation)) return implementation;
    const {render, view} = implementation;
    return {
      ...implementation,
      render: withBoundary(render, props => identityOf(props.context.componentModel), report),
      ...(view !== undefined && {
        view: withBoundary(
          view,
          props => identityOf({id: props.node.componentId, type: props.node.type}),
          report,
        ),
      }),
    };
  });
  return catalog.copyWith<ReactCatalogComponent>({components});
}
