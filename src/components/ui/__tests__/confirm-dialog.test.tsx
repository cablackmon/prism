/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '../confirm-dialog';

describe('ConfirmDialog', () => {
  it('presents Cancel before the destructive action and Cancel closes safely', async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <ConfirmDialog open title="Disable “Clean Dog Pads”?"
        description="Assigned to: Cameron. This chore cannot be completed while disabled."
        confirmLabel="Disable chore" onCancel={onCancel} onConfirm={onConfirm} />
    );

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const disable = screen.getByRole('button', { name: 'Disable chore' });
    expect(cancel.compareDocumentPosition(disable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
