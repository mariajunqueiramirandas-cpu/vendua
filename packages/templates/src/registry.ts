import type { TemplateMigration } from './migrations.ts';

// Every fleet template migration, oldest first. Core runs them (dry-run, then by
// ring); ids are permanent — Core records applications by id.
export const TEMPLATE_MIGRATIONS: readonly TemplateMigration[] = [];

export function findMigration(id: string): TemplateMigration | undefined {
  return TEMPLATE_MIGRATIONS.find((m) => m.id === id);
}
