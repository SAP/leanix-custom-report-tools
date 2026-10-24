// packages/create-custom-report/src/migrate/registry.ts
import { v1ToViteMigration } from './v1-to-vite/migration';

/**
 * A self-contained migration. The interface is deliberately minimal: it names
 * the one real extension point — which migration applies to a given project —
 * and nothing about a migration's internals, because future migrations do
 * completely different work (different detection, files, and prompts).
 */
export interface Migration {
  id: string;
  /** True if this migration applies to the given package.json. */
  appliesTo(pkg: Record<string, any>): boolean;
  /** Owns its own prompts, file writes, and console output. */
  run(ctx: { targetDir: string; pkg: Record<string, any> }): Promise<void>;
}

/** Registered migrations, in priority order. Add a new migration here. */
export const MIGRATIONS: Migration[] = [v1ToViteMigration];

/** The first migration that applies to the project, or null if none do. */
export function selectMigration(pkg: Record<string, any>): Migration | null {
  return MIGRATIONS.find((m) => m.appliesTo(pkg)) ?? null;
}
