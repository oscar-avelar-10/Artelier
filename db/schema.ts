import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const museumQuotas = sqliteTable('museum_quotas', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('museum_quotas_expiry').on(table.expiresAt)]);

export const museumCache = sqliteTable('museum_cache', {
  key: text('key').primaryKey(),
  body: text('body').notNull(),
  expiresAt: integer('expires_at').notNull(),
  staleUntil: integer('stale_until').notNull(),
}, table => [index('museum_cache_expiry').on(table.staleUntil)]);
