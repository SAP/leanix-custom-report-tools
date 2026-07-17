// packages/create-custom-report/src/migrate.ts
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ParsedArgs } from 'minimist';
import { red } from 'kolorist';
import { selectMigration } from './migrate/registry';

export async function migrate(argv: ParsedArgs): Promise<void> {
  // argv._[0] === 'migrate'; optional target dir at argv._[1]
  const targetDir = resolve(process.cwd(), (argv._[1] as string) ?? '.');
  const pkgPath = join(targetDir, 'package.json');

  if (!existsSync(pkgPath)) {
    console.error(`${red('✖')} No package.json found in ${targetDir}`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  const migration = selectMigration(pkg);
  if (!migration) {
    console.error(
      `${red('✖')} Not a v1 custom report (no migration matched ${targetDir})`
    );
    process.exit(1);
  }

  try {
    await migration.run({ targetDir, pkg });
  } catch (err) {
    console.error(
      `${red('✖')} ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}

export default migrate;
