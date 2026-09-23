'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import { useFamily } from '@/components/providers';
import { DEFAULT_PIN_LENGTH } from '@/lib/constants';

interface ExitBabysitterModeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ExitBabysitterModeModal({
  open,
  onOpenChange,
  onSuccess,
}: ExitBabysitterModeModalProps) {
  const { members: contextMembers, loading: loadingMembers } = useFamily();

  // Filter to parents only
  const parents = contextMembers
    .filter((m) => m.role === 'parent')
    .map((m) => ({
      id: m.id,
      loginIndex: m.loginIndex,
      name: m.name,
      color: m.color,
      avatarUrl: m.avatarUrl ?? undefined,
      pinLength: m.pinLength,
    }));

  const [selectedParent, setSelectedParent] = useState<(typeof parents)[0] | null>(null);
  const [pin, setPin] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  // Every pad requires exactly the SELECTED parent's own PIN length, not a
  // family-wide constant — members can have different-length PINs.
  const pinLength = selectedParent?.pinLength ?? DEFAULT_PIN_LENGTH;

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedParent(null);
      setPin([]);
      setError(null);
    }
  }, [open]);

  // pinLength must be a dependency — it changes per selected parent (their
  // own configured length), not just once per session.
  const handleKeyPress = useCallback(
    (digit: string) => {
      if (isVerifying) return;
      setError(null);
      setPin((prev) => {
        if (prev.length >= pinLength) return prev;
        return [...prev, digit];
      });
    },
    [isVerifying, pinLength]
  );

  const handleBackspace = useCallback(() => {
    if (isVerifying) return;
    setPin((prev) => prev.slice(0, -1));
    setError(null);
  }, [isVerifying]);

  // Keyboard support
  useEffect(() => {
    if (!open || !selectedParent) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isVerifying) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, selectedParent, isVerifying, handleKeyPress, handleBackspace, onOpenChange]);

  // Auto-submit when PIN is complete
  useEffect(() => {
    if (pin.length !== pinLength || !selectedParent) return;

    const verifyPin = async () => {
      setIsVerifying(true);
      const enteredPin = pin.join('');

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(selectedParent.id
              ? { userId: selectedParent.id }
              : { memberIndex: selectedParent.loginIndex }),
            pin: enteredPin,
          }),
        });

        if (response.ok) {
          onSuccess();
        } else {
          setError('Incorrect PIN');
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
          setPin([]);
        }
      } catch {
        setError('Authentication failed');
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
        setPin([]);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyPin();
  }, [pin, selectedParent, onSuccess]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70"
      onClick={(e) => {
        e.stopPropagation();
        onOpenChange(false);
      }}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Exit Babysitter Mode</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        {!selectedParent ? (
          // Parent selection
          <div className="text-center">
            <p className="mb-4 text-sm text-muted-foreground">Select a parent to unlock</p>
            {loadingMembers ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : parents.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No parents configured</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {parents.map((parent) => (
                  <button
                    key={parent.id}
                    onClick={() => setSelectedParent(parent)}
                    className={cn(
                      'flex flex-col items-center rounded-xl p-3',
                      'transition-colors hover:bg-accent/50 active:bg-accent',
                      'touch-action-manipulation'
                    )}
                  >
                    <UserAvatar
                      name={parent.name}
                      color={parent.color}
                      imageUrl={parent.avatarUrl}
                      size="lg"
                      className="mb-2 h-14 w-14"
                    />
                    <span className="text-sm font-medium">{parent.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          // PIN entry
          <div className="text-center">
            {/* Selected parent */}
            <button
              onClick={() => {
                setSelectedParent(null);
                setPin([]);
                setError(null);
              }}
              className="group mx-auto mb-4 flex flex-col items-center"
            >
              <UserAvatar
                name={selectedParent.name}
                color={selectedParent.color}
                imageUrl={selectedParent.avatarUrl}
                size="lg"
                className="mb-1 h-16 w-16 ring-primary transition-all group-hover:ring-2"
              />
              <span className="font-medium">{selectedParent.name}</span>
              <span className="text-xs text-muted-foreground">Tap to switch</span>
            </button>

            {/* PIN dots */}
            <div className={cn('mb-4 flex justify-center gap-3', isShaking && 'animate-shake')}>
              {Array.from({ length: pinLength }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-3 w-3 rounded-full transition-all duration-150',
                    i < pin.length
                      ? error
                        ? 'scale-110 bg-destructive'
                        : 'scale-110 bg-primary'
                      : 'border-2 border-border bg-muted'
                  )}
                />
              ))}
            </div>

            {/* Error/Status message */}
            <div className="mb-3 flex h-6 items-center justify-center">
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            {/* Number pad */}
            <div className="mx-auto grid max-w-[280px] grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key, idx) => {
                if (key === '') return <div key={idx} />;
                if (key === 'del') {
                  return (
                    <button
                      key={idx}
                      onClick={handleBackspace}
                      disabled={isVerifying}
                      className={cn(
                        'mx-auto h-16 w-16 rounded-full',
                        'flex items-center justify-center',
                        'bg-muted hover:bg-muted/80',
                        'active:scale-95 active:bg-accent',
                        'transition-all duration-100',
                        'text-sm text-muted-foreground',
                        isVerifying && 'opacity-50'
                      )}
                    >
                      Del
                    </button>
                  );
                }
                return (
                  <button
                    key={idx}
                    onClick={() => handleKeyPress(key)}
                    disabled={isVerifying}
                    className={cn(
                      'mx-auto h-16 w-16 rounded-full',
                      'flex items-center justify-center',
                      'bg-secondary hover:bg-secondary/80',
                      'active:scale-95 active:bg-primary active:text-primary-foreground',
                      'transition-all duration-100',
                      'text-lg font-semibold',
                      isVerifying && 'opacity-50'
                    )}
                  >
                    {key}
                  </button>
                );
              })}
            </div>

            {/* Loading indicator */}
            <div className="mt-3 flex h-6 items-center justify-center">
              {isVerifying && <p className="text-sm text-muted-foreground">Verifying...</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
