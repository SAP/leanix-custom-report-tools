import type { CustomReportMetadata } from './models/custom-report-metadata';
import type { PackageJsonLXR } from './models/package-json';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { customReportMetadataSchema } from './models/custom-report-metadata';
import { packageJsonLxrSchema } from './models/package-json';

export function readMetadataJson(
  path = resolve(process.cwd(), 'package.json')
): CustomReportMetadata {
  const pkg: PackageJsonLXR = packageJsonLxrSchema.parse(
    JSON.parse(readFileSync(path, 'utf8'))
  );
  const { name, version, author, description, leanixReport } = pkg;
  return customReportMetadataSchema.parse({ name, version, author, description, ...leanixReport });
}
