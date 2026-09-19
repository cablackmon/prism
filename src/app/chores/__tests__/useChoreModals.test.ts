/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { useChoreModals } from '../useChoreModals';
import type { Chore } from '@/types';

const originalChore = {
  id: 'chore-1',
  title: 'Old title',
  enabled: true,
  assignedTo: { id: 'person-1', name: 'Old assignee', color: '#000000' },
} as Chore;

const updatedChore = {
  title: 'Renamed chore',
  category: 'cleaning',
  frequency: 'weekly',
  pointValue: 10,
  requiresApproval: false,
  enabled: false,
  assignedTo: { id: 'person-2', name: 'New assignee' },
};

describe('useChoreModals disable safety', () => {
  const refreshChores = jest.fn();
  const setShowAddModal = jest.fn();
  const setEditingChore = jest.fn();
  const deleteChore = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('uses the submitted chore identity and cancels before PATCH', async () => {
    const confirm = jest.fn().mockResolvedValue(false);
    const { result } = renderHook(() => useChoreModals({
      refreshChores,
      setShowAddModal,
      setEditingChore,
      deleteChore,
      confirm,
    }));

    let saved = true;
    await act(async () => {
      saved = await result.current.saveEditedChore(originalChore, updatedChore);
    });

    expect(saved).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      'Disable “Renamed chore”?',
      expect.stringContaining('Assigned to: New assignee.'),
      { confirmLabel: 'Disable chore', variant: 'destructive' }
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('PATCHes only after the shared disable confirmation is accepted', async () => {
    const confirm = jest.fn().mockResolvedValue(true);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useChoreModals({
      refreshChores,
      setShowAddModal,
      setEditingChore,
      deleteChore,
      confirm,
    }));

    await act(async () => {
      await result.current.saveEditedChore(originalChore, updatedChore);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/chores/chore-1', expect.objectContaining({
      method: 'PATCH',
    }));
    expect(refreshChores).toHaveBeenCalledTimes(1);
    expect(setEditingChore).toHaveBeenCalledWith(null);
  });
});
