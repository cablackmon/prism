'use client';

interface RenameDashboardDialogProps {
  open: boolean;
  currentName: string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function RenameDashboardDialog({
  open,
  currentName,
  value,
  onChange,
  onConfirm,
  onClose,
}: RenameDashboardDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm space-y-3 rounded-lg border border-border bg-popover p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium">Rename Dashboard</div>
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            maxLength={100}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm();
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md bg-muted px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!value.trim() || value.trim() === currentName}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
