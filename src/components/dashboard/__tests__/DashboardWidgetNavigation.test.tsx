/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { DashboardWidgetNavigation } from '../DashboardWidgetNavigation';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

function touch(target: HTMLElement, x = 100, y = 100) {
  const event = {
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: y,
  };
  fireEvent.pointerDown(target, event);
  fireEvent.pointerUp(target, event);
}

describe('DashboardWidgetNavigation', () => {
  let now: number;

  beforeEach(() => {
    push.mockReset();
    now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    delete document.documentElement.dataset.kystScreensaver;
    document
      .querySelectorAll('[data-voice-assistant-active]')
      .forEach((element) => element.remove());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a widget control single tap intact without navigating', () => {
    const onClick = jest.fn();
    render(
      <DashboardWidgetNavigation widgetId="chores">
        <button onClick={onClick}>Complete chore</button>
      </DashboardWidgetNavigation>
    );

    const button = screen.getByRole('button', { name: 'Complete chore' });
    touch(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('navigates once after two nearby touch taps', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="chores">Chores</DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    touch(widget);
    now += 250;
    touch(widget, 108, 105);
    fireEvent.doubleClick(widget);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/chores');
  });

  it('keeps navigation inside a named dashboard', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="tasks" slug="hallway board">
        Tasks
      </DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    fireEvent.doubleClick(widget);

    expect(push).toHaveBeenCalledWith('/d/hallway%20board/tasks');
  });

  it('does not navigate when an interactive control is tapped twice', () => {
    const onClick = jest.fn();
    render(
      <DashboardWidgetNavigation widgetId="meals">
        <button onClick={onClick}>Next week</button>
      </DashboardWidgetNavigation>
    );
    const button = screen.getByRole('button', { name: 'Next week' });

    touch(button);
    fireEvent.click(button);
    now += 200;
    touch(button);
    fireEvent.click(button);
    fireEvent.doubleClick(button);

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
  });

  it('does not combine a widget-surface tap with a nearby control tap', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="shopping">
        <button>Complete item</button>
      </DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    touch(widget, 100, 100);
    now += 200;
    touch(screen.getByRole('button', { name: 'Complete item' }), 105, 100);

    expect(push).not.toHaveBeenCalled();
  });

  it('does not combine a modal-backdrop dismissal with a widget tap', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="meals">
        <div data-widget-navigation-ignore>Dismiss meal modal</div>
      </DashboardWidgetNavigation>
    );
    const backdrop = screen.getByText('Dismiss meal modal');
    const widget = container.firstElementChild as HTMLElement;

    touch(backdrop);
    now += 200;
    touch(widget);

    expect(push).not.toHaveBeenCalled();
  });

  it('does not combine a long press with a following tap', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="tasks">Tasks</DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    now += 1_000;
    fireEvent.pointerUp(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    now += 100;
    touch(widget);

    expect(push).not.toHaveBeenCalled();
  });

  it('does not retain a tap recorded while navigation is blocked', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="chores">Chores</DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;
    const overlay = document.createElement('div');
    overlay.dataset.voiceAssistantActive = 'true';
    document.body.appendChild(overlay);

    touch(widget);
    overlay.remove();
    now += 200;
    touch(widget);

    expect(push).not.toHaveBeenCalled();
  });

  it('does not turn scrolling or separated taps into navigation', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="tasks">Tasks</DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 40,
    });
    fireEvent.pointerUp(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 40,
    });
    now += 100;
    touch(widget, 200, 200);
    now += 100;
    touch(widget, 300, 300);

    expect(push).not.toHaveBeenCalled();
  });

  it('resets a pending first tap when the next gesture scrolls', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="tasks">Tasks</DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    touch(widget);
    now += 100;
    fireEvent.pointerDown(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 140,
    });
    fireEvent.pointerUp(widget, {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 140,
    });
    now += 100;
    touch(widget);

    expect(push).not.toHaveBeenCalled();
  });

  it('supports mouse double-click navigation', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="tasks">Tasks</DashboardWidgetNavigation>
    );

    fireEvent.doubleClick(container.firstElementChild as HTMLElement);

    expect(push).toHaveBeenCalledWith('/tasks');
  });

  it('does nothing for widgets with no full page', () => {
    const { container } = render(
      <DashboardWidgetNavigation widgetId="weather">Weather</DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    touch(widget);
    now += 200;
    touch(widget);
    fireEvent.doubleClick(widget);

    expect(push).not.toHaveBeenCalled();
    expect(widget.getAttribute('data-widget-navigation')).toBe('none');
  });

  it.each([
    [
      'screensaver',
      () => {
        document.documentElement.dataset.kystScreensaver = 'active';
      },
    ],
    [
      'Ask NOX overlay',
      () => {
        const overlay = document.createElement('div');
        overlay.dataset.voiceAssistantActive = 'true';
        document.body.appendChild(overlay);
      },
    ],
  ])('suppresses navigation while the %s is active', (_name, activate) => {
    activate();
    const { container } = render(
      <DashboardWidgetNavigation widgetId="chores">Chores</DashboardWidgetNavigation>
    );
    const widget = container.firstElementChild as HTMLElement;

    touch(widget);
    now += 200;
    touch(widget);
    fireEvent.doubleClick(widget);

    expect(push).not.toHaveBeenCalled();
  });
});
