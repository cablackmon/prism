'use client';

import * as React from 'react';
import { Delete, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * NUMBER KEY COMPONENT
 * A single key on the number pad.
 *
 * Size: 64x64px for comfortable touch targets (well above 44px Apple HIG minimum).
 */
function NumberKey({
  children,
  onClick,
  disabled = false,
  variant = 'default',
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'secondary';
  'aria-label'?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'h-16 w-16 rounded-full',
        'flex items-center justify-center',
        'text-xl font-semibold',
        'transition-all duration-100',
        'touch-action-manipulation',
        'select-none',
        variant === 'default' && [
          'bg-secondary hover:bg-secondary/80',
          'active:scale-95 active:bg-primary active:text-primary-foreground',
        ],
        variant === 'secondary' && [
          'bg-muted hover:bg-muted/80',
          'active:scale-95 active:bg-accent',
          'text-muted-foreground',
        ],
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {children}
    </button>
  );
}

interface NumberPadProps {
  onKeyPress: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * NUMBER PAD COMPONENT
 * The actual numeric keypad with 0-9, backspace, and clear.
 *
 * LAYOUT:
 * | 1 | 2 | 3 |
 * | 4 | 5 | 6 |
 * | 7 | 8 | 9 |
 * | C | 0 | ⌫ |
 */
export function NumberPad({
  onKeyPress,
  onBackspace,
  onClear,
  disabled = false,
  className,
}: NumberPadProps) {
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['clear', '0', 'backspace'],
  ];

  return (
    <div className={cn('grid gap-3', className)}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex justify-center gap-3">
          {row.map((key) => {
            if (key === 'clear') {
              return (
                <NumberKey
                  key={key}
                  onClick={onClear}
                  disabled={disabled}
                  variant="secondary"
                  aria-label="Clear PIN"
                >
                  <X className="h-5 w-5" />
                </NumberKey>
              );
            }
            if (key === 'backspace') {
              return (
                <NumberKey
                  key={key}
                  onClick={onBackspace}
                  disabled={disabled}
                  variant="secondary"
                  aria-label="Delete last digit"
                >
                  <Delete className="h-5 w-5" />
                </NumberKey>
              );
            }
            return (
              <NumberKey
                key={key}
                onClick={() => onKeyPress(key)}
                disabled={disabled}
                aria-label={`Enter digit ${key}`}
              >
                {key}
              </NumberKey>
            );
          })}
        </div>
      ))}
    </div>
  );
}
