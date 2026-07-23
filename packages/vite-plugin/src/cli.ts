import { openAsBlob } from 'node:fs';
import { join, resolve } from 'node:path';
import { ZodError } from 'zod';
import {
  authenticate,
  login as coreLogin,
  logout as coreLogout
} from '@lxr/core/auth';
import { getWorkspaceNameFromAccessToken } from '@lxr/core/oauth';
import {
  createBundle,
  readMetadataJson,
  uploadToExtensionHub,
  writeReportMetadata
} from '@lxr/core/index';

async function login(): Promise<void> {
  const { config, path } = await coreLogin();
  const workspaceName = getWorkspaceNameFromAccessToken(
    config.oauth!.access_token
  );
  console.log(`Logged in to https://${config.host}/${workspaceName}`);
  console.log(`Credentials saved to ${path}`);
}

async function logout(): Promise<void> {
  const result = await coreLogout();
  if (!result) {
    console.log('Not logged in.');
    return;
  }
  console.log(`Logged out. Credentials removed from ${result.path}`);
}

// INTERNAL ONLY — publishes a compiled report bundle to the LeanIX Extension
// Hub (torg). Regular customers publish via `vite build --mode upload` (reports
// service); this path exists for internal LeanIX use where the report is
// distributed as a store asset.
//
// Requires `leanixReport.id` in the project's package.json.
async function storeUpload(assetId: string): Promise<void> {
  console.warn(
    '⚠️  `lxr store-upload` is intended for INTERNAL SAP LeanIX use only.'
  );

  const cwd = process.cwd();

  // 1. Read + validate metadata from package.json
  let metadata;
  try {
    metadata = readMetadataJson(join(cwd, 'package.json'));
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      console.error(`💥 Could not find package.json at "${err.path}"`);
    } else if (err instanceof ZodError) {
      console.error(
        `💥 Found ${err.issues.length} errors while validating package.json`
      );
      for (const issue of err.issues) {
        console.error(
          ` ${issue.message} ${issue.path.join('.')} - ${issue.code}`
        );
      }
    } else {
      console.error(`💥 Failed to read package.json: ${err?.message ?? err}`);
    }
    process.exit(1);
  }

  // 2. Require the `id` field for store uploads
  if (!metadata.id) {
    console.error(
      '💥 `lxr store-upload` requires "leanixReport.id" in package.json.'
    );
    console.error('   Add a report id and re-run, e.g.:');
    console.error('     "leanixReport": { "id": "net.leanix.myreport", ... }');
    process.exit(1);
  }

  // 3. Authenticate — reuses the same OAuth / apitoken flow as the reports
  //    service upload. Bearer token is what torg expects.
  let bearerToken: string;
  try {
    const auth = await authenticate();
    bearerToken = auth.bearerToken;
  } catch (err) {
    console.error(
      err === 401
        ? '💥 Invalid SAP LeanIX credentials'
        : `💥 Authentication failed: ${err}`
    );
    process.exit(1);
  }

  // 4. Build the project. Vite is a peer dependency, so we import it
  //    dynamically from the consumer's node_modules rather than declaring a
  //    hard runtime dep on the plugin.
  console.log(`Building "${metadata.name}" v${metadata.version}...`);
  let outDir: string;
  try {
    const { build, resolveConfig } = await import('vite');
    const resolvedConfig = await resolveConfig({ root: cwd }, 'build');
    await build({ root: cwd, logLevel: 'info' });
    // Use the resolved build.outDir rather than assuming `dist`, so a consumer
    // that overrides build.outDir packs the same directory the plugin's
    // writeBundle hook wrote lxreport.json into.
    outDir = resolve(cwd, resolvedConfig.build.outDir);
  } catch (err: any) {
    console.error(`💥 Build failed: ${err?.message ?? err}`);
    process.exit(1);
  }

  // 5. Ensure lxreport.json (now including `id`) is inside the built output.
  //    The vite plugin's writeBundle hook already emits this during a normal
  //    `vite build`, but we call it again explicitly to make store-upload
  //    self-sufficient if someone wires it up without the plugin.
  writeReportMetadata(metadata, outDir);

  // 6. Pack dist/ into bundle.tgz and POST it to torg.
  try {
    const bundlePath = await createBundle(outDir);
    const bundle = await openAsBlob(bundlePath);
    console.log(
      `Uploading "${metadata.id}" v${metadata.version} to Extension Hub (asset ${assetId})...`
    );
    const result = await uploadToExtensionHub({
      bundle,
      bearerToken,
      assetId
    });
    console.log('');
    console.log('Store upload complete 🚀');
    if (result.data?.id) {
      console.log(`  Asset version id: ${result.data.id}`);
    }
  } catch (err: any) {
    console.error('💥 Store upload failed.');
    console.error(`${err?.message ?? err}`);
    process.exit(1);
  }
}

function printUsageAndExit(): never {
  console.error('Usage: lxr <login | logout | store-upload <asset-id>>');
  process.exit(1);
}

const command = process.argv[2];
if (command === 'login') {
  login().catch((err) => {
    console.error(`Login failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else if (command === 'logout') {
  logout().catch((err) => {
    console.error(`Logout failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else if (command === 'store-upload') {
  const assetId = process.argv[3];
  if (!assetId) {
    console.error('💥 Missing <asset-id> argument.');
    printUsageAndExit();
  }
  storeUpload(assetId).catch((err) => {
    console.error(`Store upload failed: ${err?.message ?? err}`);
    process.exit(1);
  });
} else {
  printUsageAndExit();
}
