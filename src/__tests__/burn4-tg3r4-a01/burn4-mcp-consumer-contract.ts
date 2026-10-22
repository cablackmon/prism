import { z } from 'zod';
import { id, reply } from './burn4-mcp-harness';
import type { RequestRecord } from './burn4-mcp-harness';

// Required-field subsets, reviewed at master 5452b7c6 on 2026-10-21.
// These fixtures document consumer requirements without importing or executing
// excluded API modules. They do not model auth, DB writes or optional fields.
export const consumerContracts = {
  // validations/index.ts:82-85, API chores/[id]/complete/route.ts:103-111.
  [`/api/chores/${id}/complete`]: z.object({ completedBy: z.string().uuid() }),
  // src/lib/validations/index.ts:165-171, API maintenance/route.ts:134-138.
  '/api/maintenance': z.object({
    title: z.string().min(1).max(255),
    category: z.enum(['car', 'home', 'appliance', 'yard', 'other']),
    schedule: z.enum(['monthly', 'quarterly', 'annually', 'custom']),
    nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  // src/lib/validations/index.ts:122-134, API meals/route.ts:137-141.
  '/api/meals': z.object({
    name: z.string().min(1).max(255),
    weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dayOfWeek: z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  }),
  // src/lib/validations/index.ts:241-244, API goals/route.ts:147-152.
  '/api/goals': z.object({
    name: z.string().min(1).max(255),
    pointCost: z.number().int().min(1).max(10000),
  }),
  // src/lib/validations/index.ts:148-150, API messages/route.ts:178-184 required message guard.
  '/api/messages': z.object({
    message: z.string().min(1).max(1000),
    authorId: z.string().uuid(),
  }),
};

export function consumerReply(request: RequestRecord) {
  const path = new URL(request.url).pathname as keyof typeof consumerContracts;
  const schema = consumerContracts[path];
  if (!schema || request.method !== 'POST') throw new Error('Unexpected consumer fixture request');
  const parsed = schema.safeParse(JSON.parse(request.body!));
  return parsed.success
    ? reply({ id, accepted: true }, true, 201)
    : reply({ error: 'Validation failed', fields: parsed.error.issues.map(issue => issue.path.join('.')) }, false, 400);
}

export const driftCases = [
  {
    name: 'complete_chore', path: `/api/chores/${id}/complete`,
    defect: 'uses userId instead of required completedBy',
    args: { id, userId: id, completedBy: id },
    validConsumer: { completedBy: id },
    missing: ['completedBy'],
  },
  {
    name: 'create_maintenance_item', path: '/api/maintenance',
    defect: 'uses dueDate/frequency and cannot supply required category/schedule/nextDue',
    args: { title: 'Filter', dueDate: '2026-11-01', frequency: 'monthly', category: 'home', schedule: 'monthly', nextDue: '2026-11-01' },
    validConsumer: { title: 'Filter', category: 'home', schedule: 'monthly', nextDue: '2026-11-01' },
    missing: ['category', 'schedule', 'nextDue'],
  },
  {
    name: 'create_meal', path: '/api/meals',
    defect: 'uses date and cannot supply required weekOf/dayOfWeek',
    args: { name: 'Soup', date: '2026-10-21', mealType: 'dinner', weekOf: '2026-10-19', dayOfWeek: 'wednesday' },
    validConsumer: { name: 'Soup', weekOf: '2026-10-19', dayOfWeek: 'wednesday', mealType: 'dinner' },
    missing: ['weekOf', 'dayOfWeek'],
  },
  {
    name: 'create_goal', path: '/api/goals',
    defect: 'uses title/targetPoints instead of required name/pointCost',
    args: { title: 'Museum', targetPoints: 100, name: 'Museum', pointCost: 100 },
    validConsumer: { name: 'Museum', pointCost: 100 },
    missing: ['name', 'pointCost'],
  },
  {
    name: 'post_message', path: '/api/messages',
    defect: 'uses content instead of required message',
    args: { content: 'Practice at five', authorId: id, message: 'Practice at five' },
    validConsumer: { message: 'Practice at five', authorId: id },
    missing: ['message'],
  },
] satisfies Array<{
  name: string; path: string; defect: string; args: Record<string, unknown>;
  validConsumer: Record<string, unknown>; missing: string[];
}>;


// Next App Router exports PATCH and no PUT for these resources at base master:
// chores/[id]/route.ts:134, tasks/[id]/route.ts:171,
// events/[id]/route.ts:139, shopping-items/[id]/route.ts:42.
export const methodCases = [
  { name: 'update_chore', path: `/api/chores/${id}`, args: { id, title: 'Updated' } },
  { name: 'update_task', path: `/api/tasks/${id}`, args: { id, title: 'Updated' } },
  { name: 'update_event', path: `/api/events/${id}`, args: { id, title: 'Updated' } },
  { name: 'update_shopping_item', path: `/api/shopping-items/${id}`, args: { id, checked: true } },
];

export function patchConsumerReply(request: RequestRecord) {
  if (!methodCases.some(item => new URL(request.url).pathname === item.path)) throw new Error('Unknown patch fixture route');
  return request.method === 'PATCH'
    ? reply({ accepted: true })
    : reply({ error: 'Method Not Allowed' }, false, 405);
}

// Required field type from validations/index.ts:104-107 and partial update at
// 116. Both POST shopping-items/route.ts:119 and PATCH [id]/route.ts:70 use it.
export const quantityContract = z.object({ quantity: z.number().int().positive() });
export const quantityCases = [
  { name: 'add_shopping_item', args: { name: 'Oats', listId: id, quantity: 2 } },
  { name: 'update_shopping_item', args: { id, quantity: 2 } },
];

// meals/route.ts:42-47 reads from/to, then uses inclusive range at 86-95.
// Only that date filtering boundary is modeled. There is no cache or database.
export const fixtureMeals = [
  { id: 'before', date: '2026-10-20' },
  { id: 'first', date: '2026-10-21' },
  { id: 'last', date: '2026-10-22' },
  { id: 'after', date: '2026-10-23' },
];
export function mealRangeReply(request: RequestRecord) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/meals' || request.method !== 'GET') throw new Error('Unknown meal range fixture request');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const meals = from && to ? fixtureMeals.filter(meal => meal.date >= from && meal.date <= to) : fixtureMeals;
  return reply({ meals });
}
