import type { AddLeanIXMetadataToPackageJson } from '../models/leanix-metadata';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LXR_JSON_FILENAME } from '@lxr/core/index';
import { customReportMetadataSchema } from '@lxr/core/models/custom-report-metadata';

export async function generateLeanIXFiles(
  params: AddLeanIXMetadataToPackageJson
): Promise<void> {
  const { targetDir, result } = params;
  const {
    author,
    description,
    id,
    title,
    packageName,
    host,
    apitoken,
    proxyURL
  } = result;
  let pkg = JSON.parse(
    await readFile(join(targetDir, 'package.json'), 'utf-8')
  );
  const name =
    packageName ??
    pkg.name ??
    pathToFileURL(targetDir ?? '')
      .pathname.split('/')
      .at(-1);
  const version = pkg.version ?? '0.0.0';
  const pkgMetadataFields = { name, author, description, version };
  const leanixReport = { id, title, aiAssisted: false, defaultConfig: {} };
  pkg = { ...pkg, ...pkgMetadataFields, name, leanixReport };
  const lxreportJson = { ...leanixReport, ...pkgMetadataFields };
  customReportMetadataSchema.parse(lxreportJson);
  await writeFile(
    join(targetDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );
  if (host && apitoken) {
    const lxrJson: Record<string, string> = { host, apitoken };
    if (proxyURL) lxrJson.proxyURL = proxyURL;
    await writeFile(
      join(targetDir, LXR_JSON_FILENAME),
      JSON.stringify(lxrJson, null, 2) + '\n'
    );
  }
}
