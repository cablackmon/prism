// Isolated declarations prevent TypeScript from loading existing app source.
declare module '@/lib/auth' {
  export interface AuthResult {
    userId: string;
    role: 'parent' | 'child' | 'guest';
    scopes?: string[];
  }
  export function requireAuth(): Promise<AuthResult | import('next/server').NextResponse>;
}
declare module '@/lib/db/client' {
  export const db: import('drizzle-orm/postgres-js').PostgresJsDatabase;
}
declare module '@/lib/db/schema' {
  export const shoppingItems: typeof import('./burn4-db-fixture').shoppingItems;
  export const shoppingLists: typeof import('./burn4-db-fixture').shoppingLists;
  export const auditLogs: typeof import('./burn4-db-fixture').auditLogs;
}
declare module '@/lib/cache/rateLimit' {
  export function rateLimitGuard(userId: string, resource: string, limit: number,
    windowSeconds: number): Promise<import('next/server').NextResponse | null>;
}
declare module '@/lib/cache/cacheKeys' {
  export function invalidateEntity(entity: 'shopping-lists'): Promise<void>;
}
