// Test-owned public table contract, manually checked against schema.ts.
// No application schema module is imported or executed.
import { boolean, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const shoppingLists = pgTable('shopping_lists', {
  id: uuid('id').primaryKey(),
  assignedTo: uuid('assigned_to'),
});
export const shoppingItems = pgTable('shopping_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  listId: uuid('list_id').references(() => shoppingLists.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  quantity: integer('quantity'),
  unit: varchar('unit', { length: 50 }),
  category: varchar('category', { length: 50 }),
  checked: boolean('checked').default(false).notNull(),
  recurring: boolean('recurring').default(false).notNull(),
  recurrenceInterval: varchar('recurrence_interval', { length: 20 }),
  notes: text('notes'),
  addedBy: uuid('added_by'),
  sourceId: varchar('source_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id'),
  action: varchar('action', { length: 50 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: varchar('entity_id', { length: 255 }),
  summary: varchar('summary', { length: 500 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
