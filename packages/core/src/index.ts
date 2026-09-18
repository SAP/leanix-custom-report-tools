import type {
  CustomReportRow,
  CustomReportState,
  CustomReportVersionUploadResponse,
  SecurityScan
} from '@lxr/core/models/custom-report-row';
import type { CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import type { PackageJsonLXR } from '@lxr/core/models/package-json';
import type { ReportUploadResponseData } from '@lxr/core/models/report-response-data';
import type { paths } from './generated/reports-service';
import type { ZodObject } from 'zod';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { promisify } from 'node:util';
import { execPath } from 'node:process';
import { customReportMetadataSchema } from '@lxr/core/models/custom-report-metadata';
import { CUSTOM_REPORT_TERMINAL_FAILURE_STATES } from '@lxr/core/models/custom-report-row';
import { packageJsonLxrSchema } from '@lxr/core/models/package-json';
import { jwtDecode } from 'jwt-decode';
import createClient from 'openapi-fetch';
import { c } from 'tar';
import { fetchOrThrow } from './fetch';
import { HttpError } from './errors';

const execFileAsync = promisify(execFile);

export async function validateDocument(
  document: unknown,
  name: 'lxreport.json' | 'package.json'
): Promise<PackageJsonLXR | CustomReportMetadata> {
  let schema: ZodObject<any>;
  let output: PackageJsonLXR | CustomReportMetadata;
  switch (name) {
    case 'package.json':
      schema = packageJsonLxrSchema;
      output = document as PackageJsonLXR;
      break;
    case 'lxreport.json':
      schema = customReportMetadataSchema;
      output = document as CustomReportMetadata;
      break;
    default:
      throw new Error(`unknown document name ${name}`);
  }

  schema.parse(document);
  return output;
}

export function readMetadataJson(path: string): CustomReportMetadata {
  const pkg: PackageJsonLXR = packageJsonLxrSchema.parse(
    JSON.parse(readFileSync(path, 'utf8'))
  );
  const { name, version, description, leanixReport } = pkg;
  return customReportMetadataSchema.parse({
    name,
    version,
    description,
    ...leanixReport
  });
}

export function decodeBearerToken(bearerToken: string): JwtClaims {
  return jwtDecode(bearerToken);
}

export function getLaunchUrl(
  devServerUrl: string,
  bearerToken: string,
  relayUrl: string,
  name?: string
): string {
  const decodedToken: JwtClaims = jwtDecode(bearerToken);
  const urlEncoded =
    devServerUrl === decodeURIComponent(devServerUrl)
      ? encodeURIComponent(devServerUrl)
      : devServerUrl;
  const nameParam = name ? `&name=${encodeURIComponent(name)}` : '';
  const baseLaunchUrl = `${relayUrl}/${decodedToken.principal.permission.workspaceName}/reporting/dev?url=${urlEncoded}${nameParam}#access_token=${bearerToken}`;
  return baseLaunchUrl;
}

export function writeReportMetadata(
  metadata: CustomReportMetadata,
  outDir: string
): void {
  writeFileSync(resolve(outDir, 'lxreport.json'), JSON.stringify(metadata));
}

// Creates a bundle.tgz from a compiled dist directory.
// Used by the internal `lxr store-upload` command to package a built
// custom report for Extension Hub (torg store) uploads.
export async function createBundle(outDir: string): Promise<string> {
  const bundleFilename = 'bundle.tgz';
  const targetFilePath = resolve(outDir, bundleFilename);
  if (!existsSync(outDir)) {
    throw new Error(`could not find outDir: ${outDir}`);
  }
  await c(
    {
      gzip: true,
      cwd: outDir,
      file: targetFilePath,
      filter: (path) => path !== bundleFilename
    },
    readdirSync(outDir)
  );

  return targetFilePath;
}

// Posts a bundle to torg (Extension Hub). Used by the internal
// `lxr store-upload` command. `host` accepts either a bare hostname
// (default: 'exthub.leanix.net') or a full URL with scheme.
export async function uploadToExtensionHub(params: {
  bundle: Blob;
  bearerToken: string;
  host?: string;
  assetId: string;
}): Promise<ReportUploadResponseData> {
  const { bundle, bearerToken, host, assetId } = params;
  const storeHost = host ?? 'exthub.leanix.net';
  const baseURL = storeHost.startsWith('http')
    ? storeHost
    : `https://${storeHost}`;
  const url = `${baseURL}/services/torg/v1/assetversions/${encodeURIComponent(assetId)}/payload`;

  const form = new FormData();
  form.append('file', bundle);
  const res = await fetchOrThrow(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearerToken}` },
    body: form
  });
  const contentType = res.headers.get('content-type');
  const content =
    contentType === 'application/json' ? await res.json() : await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, content);
  }
  return content as ReportUploadResponseData;
}

// Node v24 on Windows cannot spawn .cmd shims (like npm.cmd) via execFile
// without shell:true, which triggers DEP0190. Invoking npm-cli.js directly
// via the current node binary works cross-platform without either issue.
// On Windows:        <node-dir>\node_modules\npm\bin\npm-cli.js
// On Unix (Volta):   <node-dir>/../lib/node_modules/npm/bin/npm-cli.js
// On macOS Homebrew: <node-dir>/../libexec/lib/node_modules/npm/bin/npm-cli.js
let cachedNpmCli: string | undefined;
function resolveNpmCli(): string {
  if (cachedNpmCli !== undefined) return cachedNpmCli;
  const binDir = dirname(execPath);
  const candidates = [
    join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(binDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(
      binDir,
      '..',
      'libexec',
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    )
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Cannot locate npm-cli.js (tried ${candidates.join(', ')})`
    );
  }
  cachedNpmCli = found;
  return found;
}

// Extracts the packed file list from `npm pack --dry-run --json`, tolerating
// both shapes: the legacy array `[{ files }]` (npm <12) and the object keyed
// by package name `{ "<name>": { files } }` introduced in npm 12.
export function parsePackFileList(stdout: string): string[] {
  const parsed: unknown = JSON.parse(stdout);
  const entry = Array.isArray(parsed)
    ? parsed[0]
    : parsed && typeof parsed === 'object'
      ? Object.values(parsed)[0]
      : undefined;
  const files = (entry as { files?: unknown } | undefined)?.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`unexpected npm pack output: ${stdout}`);
  }
  return files.map((file) => {
    const path = (file as { path?: unknown } | undefined)?.path;
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`unexpected npm pack output: ${stdout}`);
    }
    return path;
  });
}

export async function npmPackBundle(cwd: string): Promise<string> {
  const npmCli = resolveNpmCli();
  const packDir = mkdtempSync(join(tmpdir(), 'lxr-npm-pack-'));
  // Ask npm which files it would pack (honouring `files`/`.npmignore`) without
  // writing a tarball, then build the tarball ourselves. We cannot let `npm
  // pack` produce it directly: npm-packlist@11 (bundled with npm 12)
  // strict-excludes package-lock.json, yet the reports builder needs it inside
  // the tarball for `npm ci` and `npm audit --package-lock-only`.
  const { stdout } = await execFileAsync(
    execPath,
    [npmCli, 'pack', '--dry-run', '--json'],
    { cwd }
  );
  const files = parsePackFileList(stdout);
  if (
    existsSync(resolve(cwd, 'package-lock.json')) &&
    !files.includes('package-lock.json')
  ) {
    files.push('package-lock.json');
  }
  const tarballPath = resolve(packDir, 'bundle.tgz');
  // `prefix: 'package'` reproduces the `package/` top level that `npm pack`
  // emits and that the builder strips with `tar --strip-components=1`.
  await c({ gzip: true, cwd, file: tarballPath, prefix: 'package' }, files);
  return tarballPath;
}

function reportsServiceClient(params: {
  host: string;
  bearerToken: string;
  baseURL?: string;
}): ReturnType<typeof createClient<paths>> {
  const { host, bearerToken, baseURL } = params;
  return createClient<paths>({
    baseUrl: baseURL ?? `https://${host}/services/reports/v1`,
    headers: { Authorization: `Bearer ${bearerToken}` },
    fetch: fetchOrThrow
  });
}

export async function uploadToWorkspace(params: {
  host: string;
  bearerToken: string;
  bundle: Blob;
  baseURL?: string;
}): Promise<CustomReportVersionUploadResponse> {
  const { bundle } = params;
  const client = reportsServiceClient(params);
  const { data, error, response } = await client.POST(
    '/customReportVersions/upload',
    {
      body: bundle,
      bodySerializer: (b) => b,
      headers: { 'Content-Type': 'application/gzip' }
    }
  );
  if (error !== undefined || !response.ok || data === undefined) {
    throw new HttpError(response.status, error ?? data);
  }
  return data;
}

export class ReportStateError extends Error {
  constructor(
    public readonly status: CustomReportState,
    public readonly buildLog: string | null,
    public readonly securityScan: SecurityScan | null,
    message: string
  ) {
    super(message);
    this.name = 'ReportStateError';
  }
}

export async function pollReportState(params: {
  host: string;
  customReportVersionId: string;
  bearerToken: string;
  onUpdate?: (state: CustomReportState) => void;
  intervalMs?: number;
  timeoutMs?: number;
  baseURL?: string;
}): Promise<CustomReportRow> {
  const {
    customReportVersionId,
    onUpdate,
    intervalMs = 2000,
    timeoutMs = 5 * 60 * 1000
  } = params;
  const client = reportsServiceClient(params);
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + timeoutMs;
  let lastState: CustomReportState | null = null;
  while (Date.now() < deadline) {
    const { data, error, response } = await client.GET(
      '/customReportVersions/{customReportVersionId}',
      {
        params: { path: { customReportVersionId }, query: { scanVersion: '1' } }
      }
    );
    if (error !== undefined || data === undefined) {
      throw new HttpError(response.status, error);
    }
    const row: CustomReportRow = {
      id: data.id,
      status: data.status,
      buildLog: data.buildLog ?? null,
      securityScan: data.securityScan ?? null
    };
    if (row.status !== lastState) {
      lastState = row.status;
      onUpdate?.(row.status);
    }
    if (row.status === 'READY') {
      return row;
    }
    if (CUSTOM_REPORT_TERMINAL_FAILURE_STATES.includes(row.status)) {
      const reason =
        row.status === 'VULNERABLE'
          ? 'security scan found vulnerabilities'
          : 'build failed';
      throw new ReportStateError(
        row.status,
        row.buildLog,
        row.securityScan,
        `${row.status}: ${reason}`
      );
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for report ${customReportVersionId} to reach ready state (last state: ${lastState ?? 'unknown'})`
  );
}
