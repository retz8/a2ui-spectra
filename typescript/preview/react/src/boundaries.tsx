/**
 * Every catalog component in a boundary of its own, so one that throws is
 * reported with its id and type and leaves the rest of the surface drawn. A
 * React implementation gets an error boundary around its view, in a copy of
 * the page's catalog, which draws it again once what it draws from changes,
 * as a web component is updated again; a web component, such as web core's
 * universal elements, which both basic catalogs are drawn with, is guarded
 * at its updates by the core.
 */
import type {ReactCatalogComponent} from '@a2ui/react/v0_9';
import {
  type Catalog,
  type ComponentModel,
  type ComponentNode,
  effect,
  getValue,
} from '@a2ui/web_core/v0_9';
import type {PageEvents} from 'a2ui-spectra-preview';
import {identityOf} from 'a2ui-spectra-preview/web-core';
import {Component, type FC, type ReactNode} from 'react';

/** The component a failure belongs to. */
interface Identity {
  componentId?: string;
  componentType?: string;
}

type Report = PageEvents['componentFailed'];

/** Calls back when what a component draws from changes; returns the way to stop. */
type Watch = (onChange: () => void) => () => void;

/** Watches a node's props, the view's input. */
function watchNode(node: ComponentNode): Watch {
  return onChange => {
    let first = true;
    return effect(() => {
      getValue(node.props);
      if (first) first = false;
      else onChange();
    });
  };
}

/** Watches a component model's properties, the render's input. */
function watchModel(model: ComponentModel): Watch {
  return onChange => {
    const subscription = model.onUpdated.subscribe(() => onChange());
    return () => subscription.unsubscribe();
  };
}

class ComponentBoundary extends Component<
  Identity & {report: Report; watch: Watch; children: ReactNode},
  {failed: boolean}
> {
  override state = {failed: false};
  /** While the component stays failed, the way to stop watching what it draws from. */
  private stopWatching: (() => void) | undefined;

  static getDerivedStateFromError(): {failed: boolean} {
    return {failed: true};
  }

  override componentDidCatch(error: unknown): void {
    const {componentId, componentType, report, watch} = this.props;
    report({componentId, componentType, error});
    this.stopWatching ??= watch(() => this.setState({failed: false}));
  }

  override componentDidUpdate(_: unknown, before: {failed: boolean}): void {
    if (before.failed && !this.state.failed) {
      this.stopWatching?.();
      this.stopWatching = undefined;
    }
  }

  override componentWillUnmount(): void {
    this.stopWatching?.();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function withBoundary<Props extends object>(
  Inner: FC<Props>,
  identify: (props: Props) => Identity,
  watchOf: (props: Props) => Watch,
  report: Report,
): FC<Props> {
  const Guarded: FC<Props> = props => (
    <ComponentBoundary {...identify(props)} watch={watchOf(props)} report={report}>
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
      render: withBoundary(
        render,
        props => identityOf(props.context.componentModel),
        props => watchModel(props.context.componentModel),
        report,
      ),
      ...(view !== undefined && {
        view: withBoundary(
          view,
          props => identityOf({id: props.node.componentId, type: props.node.type}),
          props => watchNode(props.node),
          report,
        ),
      }),
    };
  });
  return catalog.copyWith<ReactCatalogComponent>({components});
}
