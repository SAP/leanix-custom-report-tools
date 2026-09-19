# Migration fixtures

Minimal legacy (v1 CLI / webpack) custom reports, one per supported framework,
used by `src/migrate/fixtures.spec.ts` to verify that `runMigration` emits the
correct Vite setup.

## Guided manual build verification (POC success criterion)

The automated test asserts the migrated manifest/config is correct. To confirm a
migrated project actually _builds_, run once per fixture:

    cp -r test-fixtures/v1-to-vite/<framework> /tmp/<framework>-check
    cd /tmp/<framework>-check
    npx @sap/create-leanix-custom-report migrate .
    npm install
    npm run build   # expect: vite build completes without error

Then `npm run dev` and confirm the report loads in the SAP LeanIX shell.
