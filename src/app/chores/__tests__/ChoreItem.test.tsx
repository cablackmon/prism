/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { ChoreItem } from '../ChoreItem';
import type { Chore } from '@/types';

const chore = {
  id: 'chore-1',
  title: 'Clean Dog Pads',
  description: null,
  category: 'pets',
  frequency: 'daily',
  pointValue: 5,
  requiresApproval: false,
  enabled: true,
  nextDue: null,
  assignedTo: { id: 'person-1', name: 'Cameron', color: '#2563eb' },
  pendingApproval: null,
  createdAt: new Date(),
} as unknown as Chore;

describe('ChoreItem destructive-action safety', () => {
  it('keeps edit and destructive controls in separate, touch-sized groups', () => {
    render(
      <ChoreItem chore={chore} onComplete={jest.fn()} onToggleEnabled={jest.fn()}
        onEdit={jest.fn()} onDelete={jest.fn()} />
    );

    const edit = screen.getByRole('button', { name: 'Edit chore' });
    const destructiveGroup = screen.getByLabelText('Chore controls');
    const disable = screen.getByRole('switch', { name: 'Disable Clean Dog Pads' });
    const deleteButton = screen.getByRole('button', { name: 'Delete Clean Dog Pads' });

    expect(edit.parentElement).not.toBe(destructiveGroup);
    expect(edit.className).toContain('h-14');
    expect(edit.parentElement?.className).toContain('gap-11');
    expect(disable).toBeTruthy();
    expect(deleteButton.className).toContain('h-14');
    expect(deleteButton.className).toContain('min-w-14');
  });

  it('does not trigger disable when the separated Edit control is tapped', () => {
    const onEdit = jest.fn();
    const onToggleEnabled = jest.fn();
    render(
      <ChoreItem chore={chore} onComplete={jest.fn()} onToggleEnabled={onToggleEnabled}
        onEdit={onEdit} onDelete={jest.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit chore' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onToggleEnabled).not.toHaveBeenCalled();
  });
});
