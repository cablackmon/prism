'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/ui/avatar';
import { useFamily } from '@/components/providers';
import { DEFAULT_PIN_LENGTH } from '@/lib/constants';
import { PinEditModal } from '../components/PinEditModal';
import type { FamilyMember } from '../components/PinEditModal';

interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

type TokenScopeChoice = 'voice' | '*';

const SCOPE_LABELS: Record<TokenScopeChoice, string> = {
  voice: 'Voice API only (recommended)',
  '*': 'Full access (legacy)',
};

const SCOPE_DESCRIPTIONS: Record<TokenScopeChoice, string> = {
  voice: 'Limited to /api/v1/voice/* — for Alexa skills, Home Assistant, voice agents.',
  '*': 'Grants parent-level access to every endpoint. Use only for tools that need full control.',
};

export function SecuritySection() {
  const { members: familyMembers, refresh: refreshFamily } = useFamily();
  const [editingPinMember, setEditingPinMember] = useState<FamilyMember | null>(null);

  // API Tokens state
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScope, setNewTokenScope] = useState<TokenScopeChoice>('voice');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/tokens');
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens);
      }
    } catch {
      // Silently fail — user may not have permissions
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTokenName.trim(),
          scopes: [newTokenScope],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedToken(data.token);
        setNewTokenName('');
        setCopied(false);
        fetchTokens();
      }
    } catch {
      // Error handled by API
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeToken = async (id: string) => {
    setRevoking(id);
    try {
      const res = await fetch(`/api/auth/tokens/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTokens((prev) => prev.filter((t) => t.id !== id));
      }
    } catch {
      // Error handled by API
    } finally {
      setRevoking(null);
    }
  };

  const handleCopyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
    } catch {
      // Clipboard API may not be available
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Security Settings</h2>
        <p className="text-muted-foreground">Manage authentication and access</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Member PINs</CardTitle>
          <CardDescription>
            Manage PIN codes for family members. PINs are required when taking actions like posting
            messages or completing tasks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {familyMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={member.name}
                  color={member.color}
                  size="md"
                  className="h-10 w-10"
                />
                <div>
                  <div className="font-medium">{member.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {member.hasPin ? (
                      <span className="text-green-600">
                        PIN set &middot; {member.pinLength ?? DEFAULT_PIN_LENGTH} digits
                      </span>
                    ) : (
                      <span className="text-orange-600">No PIN set</span>
                    )}
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditingPinMember(member)}>
                {member.hasPin ? 'Change PIN' : 'Set PIN'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Tokens</CardTitle>
          <CardDescription>
            Generate long-lived tokens for external integrations like Alexa skills, Home Assistant,
            Node-RED, or custom scripts. Pick the smallest scope that works — a leaked Voice token
            can&apos;t reach the rest of your data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create new token */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="token-name" className="sr-only">
                  Token name
                </Label>
                <Input
                  id="token-name"
                  placeholder="Token name (e.g. Alexa skill)"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateToken()}
                  maxLength={100}
                />
              </div>
              <select
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={newTokenScope}
                onChange={(e) => setNewTokenScope(e.target.value as TokenScopeChoice)}
                aria-label="Token scope"
              >
                {(['voice', '*'] as const).map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABELS[scope]}
                  </option>
                ))}
              </select>
              <Button onClick={handleCreateToken} disabled={!newTokenName.trim() || creating}>
                {creating ? 'Creating...' : 'Generate Token'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{SCOPE_DESCRIPTIONS[newTokenScope]}</p>
          </div>

          {/* Show newly created token */}
          {createdToken && (
            <div className="space-y-2 rounded-md border border-green-500/50 bg-green-50 p-3 dark:bg-green-950/20">
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                Token created! Copy it now — it won&apos;t be shown again.
              </p>
              <div className="flex gap-2">
                <code className="flex-1 select-all break-all rounded border border-border bg-background p-2 font-mono text-xs">
                  {createdToken}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopyToken}>
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setCreatedToken(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Token list */}
          {tokens.length > 0 ? (
            <div className="space-y-2">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {token.name}
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                          token.scopes.includes('*')
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                            : 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                        }`}
                      >
                        {token.scopes.join(', ')}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatDate(token.createdAt)}
                      {token.lastUsedAt && <> &middot; Last used {formatDate(token.lastUsedAt)}</>}
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revoking === token.id}
                    onClick={() => handleRevokeToken(token.id)}
                  >
                    {revoking === token.id ? 'Revoking...' : 'Revoke'}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No API tokens yet. Generate one to connect external services.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authentication Mode</CardTitle>
          <CardDescription>How KYST handles user authentication</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-accent/50 p-3">
            <div className="mb-1 font-medium">View Freely, Authenticate to Act</div>
            <p className="text-sm text-muted-foreground">
              Anyone can view the dashboard. When taking an action (posting a message, completing a
              task, etc.), a PIN prompt appears to identify who is taking the action.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session Timeout</CardTitle>
          <CardDescription>Auto-logout after inactivity</CardDescription>
        </CardHeader>
        <CardContent>
          <select className="w-full rounded-md border border-border bg-background px-3 py-2">
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="never">Never</option>
          </select>
        </CardContent>
      </Card>

      {editingPinMember && (
        <PinEditModal
          member={editingPinMember}
          onClose={() => setEditingPinMember(null)}
          onSaved={() => {
            refreshFamily();
            setEditingPinMember(null);
          }}
        />
      )}
    </div>
  );
}
