'use client';

import * as React from 'react';

export type Burn4ExpanderPanel = {
  id: string;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
};

export type Burn4LayoutExpanderProps = {
  panels: readonly Burn4ExpanderPanel[];
  openIds?: readonly string[];
  defaultOpenIds?: readonly string[];
  onOpenChange?: (openIds: readonly string[]) => void;
  mode?: 'single' | 'multiple';
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  label?: string;
  className?: string;
};

type ControllerProps = Burn4LayoutExpanderProps & { idBase: string };
type FocusSnapshot = { id: string; kind: 'body' | 'header'; element: Element };
type State = { openIds: readonly string[] };

function validate(props: Burn4LayoutExpanderProps): void {
  if (props.label !== undefined && props.label.trim() === '') {
    throw new Error('Expander collection label must be nonempty.');
  }
  const ids = new Set<string>();
  for (const panel of props.panels) {
    if (typeof panel.id !== 'string' || panel.id.trim() === '' || ids.has(panel.id)) {
      throw new Error('Expander panel IDs must be nonempty and unique.');
    }
    if (typeof panel.title !== 'string' || panel.title.trim() === '') {
      throw new Error('Expander panel titles must be nonempty.');
    }
    ids.add(panel.id);
  }
}

function canonical(props: Burn4LayoutExpanderProps, requested: readonly string[]): string[] {
  const ids = new Set(requested);
  const ordered = props.panels.filter((panel) => ids.has(panel.id)).map((panel) => panel.id);
  return props.mode === 'single' ? ordered.slice(0, 1) : ordered;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Captures focus before React hides or removes a panel, then recovers it after commit. */
class ExpanderController extends React.Component<ControllerProps, State, FocusSnapshot | null> {
  private readonly controlled: boolean;
  private pendingIds: readonly string[];
  private readonly root = React.createRef<HTMLDivElement>();
  private readonly headers = new Map<string, HTMLButtonElement>();
  private readonly bodies = new Map<string, HTMLDivElement>();
  private readonly domKeys = new Map<string, number>();

  constructor(props: ControllerProps) {
    super(props);
    validate(props);
    this.controlled = props.openIds !== undefined;
    this.pendingIds = canonical(props, props.defaultOpenIds ?? []);
    this.state = { openIds: this.pendingIds };
  }

  private openIds(): string[] {
    return canonical(this.props, this.controlled ? this.props.openIds ?? [] : this.state.openIds);
  }

  getSnapshotBeforeUpdate(): FocusSnapshot | null {
    const active = this.root.current?.ownerDocument.activeElement;
    if (!active) return null;
    for (const [id, body] of this.bodies) {
      if (body.contains(active)) return { id, kind: 'body', element: active };
    }
    for (const [id, header] of this.headers) {
      if (header === active) return { id, kind: 'header', element: active };
    }
    return null;
  }

  componentDidUpdate(_previousProps: ControllerProps, _previousState: State, focus: FocusSnapshot | null): void {
    const openIds = this.openIds();
    if (!this.controlled) {
      this.pendingIds = openIds;
      if (!sameIds(this.state.openIds, openIds)) this.setState({ openIds });
    }
    if (!focus) return;
    const panelIndex = this.props.panels.findIndex((panel) => panel.id === focus.id);
    const panel = this.props.panels[panelIndex];
    const lostTarget = !panel || (focus.kind === 'body'
      ? !openIds.includes(focus.id)
      : panel.disabled || this.headers.get(focus.id) !== focus.element);
    if (!lostTarget) return;
    const doc = this.root.current?.ownerDocument;
    // Respect focus deliberately moved elsewhere by the caller during this commit.
    if (!doc || (doc.activeElement !== focus.element && doc.activeElement !== doc.body)) return;
    this.recoverFocus(panelIndex);
  }

  private recoverFocus(index: number): void {
    const panels = this.props.panels;
    const order = index < 0
      ? panels.map((_, position) => position)
      : [index, ...panels.flatMap((_, distance) => distance === 0 ? [] : [index + distance, index - distance])];
    for (const position of order) {
      const panel = panels[position];
      const header = panel && !panel.disabled ? this.headers.get(panel.id) : undefined;
      if (header) { header.focus(); return; }
    }
    this.root.current?.focus();
  }

  private toggle = (id: string): void => {
    const panel = this.props.panels.find((entry) => entry.id === id);
    if (!panel || panel.disabled) return;
    const current = this.controlled ? this.openIds() : canonical(this.props, this.pendingIds);
    const next = canonical(this.props, current.includes(id)
      ? current.filter((entry) => entry !== id)
      : this.props.mode === 'single' ? [id] : [...current, id]);
    if (!this.controlled) {
      this.pendingIds = [...next];
      this.setState({ openIds: [...next] });
    }
    this.props.onOpenChange?.([...next]);
  };

  private navigate = (event: React.KeyboardEvent<HTMLButtonElement>, id: string): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const enabled = this.props.panels.filter((panel) => !panel.disabled);
    const index = enabled.findIndex((panel) => panel.id === id);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (index + 1) % enabled.length; break;
      case 'ArrowUp': next = (index + enabled.length - 1) % enabled.length; break;
      case 'Home': next = 0; break;
      case 'End': next = enabled.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const target = enabled[next];
    if (target) this.headers.get(target.id)?.focus();
  };

  render(): React.ReactNode {
    validate(this.props);
    if (this.controlled !== (this.props.openIds !== undefined)) {
      throw new Error('Expander ownership must stay controlled or local; remount to switch.');
    }
    const openIds = this.openIds();
    const Heading = `h${this.props.headingLevel ?? 3}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    return (
      <div ref={this.root} role="group" aria-label={this.props.label ?? 'Expandable widgets'}
        tabIndex={-1} className={this.props.className}>
        {this.props.panels.map((panel) => {
          let key = this.domKeys.get(panel.id);
          if (key === undefined) { key = this.domKeys.size; this.domKeys.set(panel.id, key); }
          const headerId = `${this.props.idBase}-${key}-header`;
          const bodyId = `${this.props.idBase}-${key}-body`;
          const open = openIds.includes(panel.id);
          return (
            <div key={panel.id}>
              <Heading>
                <button ref={(node) => { if (node) this.headers.set(panel.id, node); else this.headers.delete(panel.id); }}
                  id={headerId} type="button" disabled={panel.disabled} aria-expanded={open}
                  aria-controls={bodyId} onClick={() => this.toggle(panel.id)}
                  onKeyDown={(event) => this.navigate(event, panel.id)}>
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>{' '}{panel.title}
                </button>
              </Heading>
              <div ref={(node) => { if (node) this.bodies.set(panel.id, node); else this.bodies.delete(panel.id); }}
                id={bodyId} role="region" aria-labelledby={headerId} hidden={!open}>
                {panel.children}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
}

/** Inline disclosures with retained bodies. Ownership is fixed for each mounted instance. */
export function Burn4LayoutExpander(props: Burn4LayoutExpanderProps): React.ReactElement {
  const idBase = React.useId();
  return <ExpanderController {...props} idBase={idBase} />;
}
