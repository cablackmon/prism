/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { ChoreGroupCard } from '../ChoreGroupCard';

const chore = {
  id: 'chore-1',
  title: 'Clean Dog Pads',
  pointValue: 5,
  nextDue: null,
  lastCompleted: null,
  pendingApproval: null,
};

describe('ChoreGroupCard action safety', () => {
  it('does not complete a chore when the action footer padding is tapped', () => {
    const onComplete = jest.fn().mockResolvedValue(true);
    const { container } = render(
      <ChoreGroupCard
        chore={chore}
        assignedUser={{ id: 'person-1', name: 'Cameron' }}
        allChores={[chore]}
        onComplete={onComplete}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        setCelebratingUser={jest.fn()}
      />
    );

    const footer = container.querySelector('.border-t');
    expect(footer).not.toBeNull();
    fireEvent.click(footer!);

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('keeps the grouped Edit and Delete controls separated by a 44px gap', () => {
    render(
      <ChoreGroupCard
        chore={chore}
        assignedUser={{ id: 'person-1', name: 'Cameron' }}
        allChores={[chore]}
        onComplete={jest.fn().mockResolvedValue(true)}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        setCelebratingUser={jest.fn()}
      />
    );

    const edit = screen.getByRole('button', { name: 'Edit Clean Dog Pads' });
    const remove = screen.getByRole('button', { name: 'Delete Clean Dog Pads' });
    expect(edit.parentElement).toBe(remove.parentElement?.parentElement);
    expect(edit.parentElement?.className).toContain('gap-11');
  });
});
