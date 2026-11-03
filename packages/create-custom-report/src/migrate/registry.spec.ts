// packages/create-custom-report/src/migrate/registry.spec.ts
import { describe, expect, it } from 'vitest';
import { selectMigration } from './registry';

const V1_PKG = {
  name: 'lix-report-keyfacts',
  dependencies: { '@leanix/reporting': '^0.4.148' },
  devDependencies: { webpack: '^5' }
};

describe('selectMigration', () => {
  it('selects the v1-to-vite migration for a v1 report', () => {
    expect(selectMigration(V1_PKG)?.id).toBe('v1-to-vite');
  });

  it('returns null when no migration applies', () => {
    expect(selectMigration({ dependencies: { express: '^4' } })).toBeNull();
  });
});
