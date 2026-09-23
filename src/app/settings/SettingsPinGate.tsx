'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/avatar';
import { useFamily, useAuth } from '@/components/providers';
import { DEFAULT_PIN_LENGTH } from '@/lib/constants';
import { SettingsView } from './SettingsView';

type GateState = 'checking' | 'prompt' | 'verified';

export function SettingsPinGate() {
  const router = useRouter();
  const { setActiveUser } = useAuth();
  const [state, setState] = useState<GateState>('checking');

  // Check if already verified (within 10-minute window)
  useEffect(() => {
    fetch('/api/auth/settings-verified')
      .then((res) => res.json())
      .then((data) => {
        setState(data.verified ? 'verified' : 'prompt');
      })
      .catch(() => setState('prompt'));
  }, []);

  const handleVerified = useCallback(
    (user?: {
      id: string;
      name: string;
      role: string;
      color: string;
      avatarUrl?: string | null;
    }) => {
      setState('verified');
      // Set the active user in AuthProvider so the login carries over to the app
      if (user) {
        setActiveUser({
          id: user.id,
          name: user.name,
          role: user.role as 'parent' | 'child' | 'guest',
          color: user.color,
          avatarUrl: user.avatarUrl ?? undefined,
        });
        // Refresh FamilyProvider so member IDs + roles reflect the authenticated session
        window.dispatchEvent(new Event('prism:auth-changed'));
      }
    },
    [setActiveUser]
  );

  const handleDismiss = useCallback(() => {
    router.push('/');
  }, [router]);

  if (state === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (state === 'verified') {
    return <SettingsView />;
  }

  return <SettingsPinPrompt onVerified={handleVerified} onDismiss={handleDismiss} />;
}

function SettingsPinPrompt({
  onVerified,
  onDismiss,
}: {
  onVerified: (user?: {
    id: string;
    name: string;
    role: string;
    color: string;
    avatarUrl?: string | null;
  }) => void;
  onDismiss: () => void;
}) {
  const { members, loading } = useFamily();
  // Parents only — children/guests can't manage settings. `/api/family` now
  // returns `role` even when unauthenticated (it isn't sensitive), so this
  // is a plain equality check; previously the fallback `!m.role` treated a
  // missing role as "assume parent," which showed every child as selectable
  // here since the unauthenticated response omitted role entirely.
  const parents = members
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
  const [mounted, setMounted] = useState(false);

  // Every pad requires exactly the SELECTED parent's own PIN length, not a
  // family-wide constant — members can have different-length PINs.
  const pinLength = selectedParent?.pinLength ?? DEFAULT_PIN_LENGTH;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-select if only one parent
  useEffect(() => {
    if (parents.length === 1 && !selectedParent && parents[0]) {
      setSelectedParent(parents[0]);
    }
  }, [parents, selectedParent]);

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
    if (!selectedParent) return;

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
        onDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedParent, isVerifying, handleKeyPress, handleBackspace, onDismiss]);

  // Auto-submit when PIN is complete
  useEffect(() => {
    if (pin.length !== pinLength || !selectedParent) return;

    const verifyPin = async () => {
      setIsVerifying(true);
      const enteredPin = pin.join('');

      try {
        const response = await fetch('/api/auth/verify-pin', {
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
          const data = await response.json();
          onVerified(data.user);
        } else {
          const data = await response.json();
          setError(data.error || 'Incorrect PIN');
          setIsShaking(true);
          setTimeout(() => setIsShaking(false), 500);
          setPin([]);
        }
      } catch {
        setError('Verification failed');
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
        setPin([]);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyPin();
  }, [pin, selectedParent, onVerified]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="mx-4 w-full max-w-[20rem] rounded-2xl bg-card p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
          <div>
            <h2 className="text-base font-semibold leading-tight">Parent PIN Required</h2>
            <p className="text-xs text-muted-foreground">Select a parent to continue</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onDismiss} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        ) : (
          <div className="grid">
            {/* PIN entry — always rendered (sets card height), fades out during parent selection */}
            <div
              className={cn(
                'text-center transition-opacity duration-150 [grid-area:1/1]',
                !selectedParent && 'pointer-events-none opacity-0'
              )}
            >
              {/* Avatar section — invisible placeholder when no parent yet */}
              {!selectedParent ? (
                <div className="invisible mx-auto mb-1.5 flex flex-col items-center" aria-hidden>
                  <div className="h-12 w-12 rounded-full" />
                  <span className="text-sm font-medium">name</span>
                  <span className="text-[10px]">subtitle</span>
                </div>
              ) : parents.length > 1 ? (
                <button
                  onClick={() => {
                    setSelectedParent(null);
                    setPin([]);
                    setError(null);
                  }}
                  className="group mx-auto mb-1.5 flex flex-col items-center"
                >
                  <UserAvatar
                    name={selectedParent.name}
                    color={selectedParent.color}
                    imageUrl={selectedParent.avatarUrl}
                    size="lg"
                    className="h-12 w-12 ring-primary transition-all group-hover:ring-2"
                  />
                  <span className="mt-0.5 text-sm font-medium">{selectedParent.name}</span>
                  <span className="text-[10px] text-muted-foreground">Tap to switch</span>
                </button>
              ) : (
                <div className="mx-auto mb-1.5 flex flex-col items-center">
                  <UserAvatar
                    name={selectedParent.name}
                    color={selectedParent.color}
                    imageUrl={selectedParent.avatarUrl}
                    size="lg"
                    className="h-12 w-12 ring-2 ring-primary"
                  />
                  <span className="mt-0.5 text-sm font-medium">{selectedParent.name}</span>
                  <span className="text-[10px] text-muted-foreground">Enter your PIN</span>
                </div>
              )}

              {/* PIN dots */}
              <div className={cn('mb-1 flex justify-center gap-1.5', isShaking && 'animate-shake')}>
                {Array.from({ length: pinLength }, (_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-2.5 w-2.5 rounded-full transition-all duration-150',
                      i < pin.length
                        ? error
                          ? 'scale-110 bg-destructive'
                          : 'scale-110 bg-primary'
                        : 'border-2 border-border bg-muted'
                    )}
                  />
                ))}
              </div>

              {/* Error message */}
              <div className="flex h-4 items-center justify-center">
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>

              {/* Number pad */}
              <div className="mx-auto grid max-w-[200px] grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key, idx) => {
                  if (key === '') return <div key={idx} />;
                  if (key === 'del') {
                    return (
                      <button
                        key={idx}
                        onClick={handleBackspace}
                        disabled={isVerifying}
                        className={cn(
                          'mx-auto flex h-12 w-12 items-center justify-center rounded-full',
                          'bg-muted hover:bg-muted/80 active:scale-95 active:bg-accent',
                          'text-xs text-muted-foreground transition-all duration-100',
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
                        'mx-auto flex h-12 w-12 items-center justify-center rounded-full',
                        'bg-secondary hover:bg-secondary/80',
                        'active:scale-95 active:bg-primary active:text-primary-foreground',
                        'text-base font-semibold transition-all duration-100',
                        isVerifying && 'opacity-50'
                      )}
                    >
                      {key}
                    </button>
                  );
                })}
              </div>

              {/* Loading */}
              <div className="mt-1.5 flex h-4 items-center justify-center">
                {isVerifying && <p className="text-xs text-muted-foreground">Verifying...</p>}
              </div>
            </div>

            {/* Parent selection — overlays same grid cell, centered, fades out when PIN is active */}
            <div
              className={cn(
                'flex flex-col justify-center text-center transition-opacity duration-150 [grid-area:1/1]',
                selectedParent && 'pointer-events-none opacity-0'
              )}
            >
              <div className="grid grid-cols-2 gap-1.5">
                {parents.map((parent) => (
                  <button
                    key={parent.id}
                    onClick={() => setSelectedParent(parent)}
                    className={cn(
                      'flex flex-col items-center rounded-xl p-1.5',
                      'transition-colors hover:bg-accent/50 active:bg-accent',
                      'touch-action-manipulation'
                    )}
                  >
                    <UserAvatar
                      name={parent.name}
                      color={parent.color}
                      imageUrl={parent.avatarUrl}
                      size="lg"
                      className="mb-1 h-12 w-12"
                    />
                    <span className="text-xs font-medium">{parent.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
