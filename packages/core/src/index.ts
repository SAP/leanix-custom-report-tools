import type {
  CustomReportRow,
  CustomReportState,
  CustomReportVersionUploadResponse,
  SecurityScan
} from '@lxr/core/models/custom-report-row';
import type { CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import type { PackageJsonLXR } from '@lxr/core/models/package-json';
import type {
  ReportUploadResponseData,
  ReportsResponseData
} from '@lxr/core/models/report-response-data';
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
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import { promisify } from 'node:util';
import { customReportMetadataSchema } from '@lxr/core/models/custom-report-metadata';
import { CUSTOM_REPORT_TERMINAL_FAILURE_STATES } from '@lxr/core/models/custom-report-row';
import { packageJsonLxrSchema } from '@lxr/core/models/package-json';
import { jwtDecode } from 'jwt-decode';
import createClient from 'openapi-fetch';
import { c } from 'tar';

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
  const { name, version, author, description, leanixReport } = pkg;
  return customReportMetadataSchema.parse({
    name,
    version,
    author,
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

export async function uploadBundle(params: {
  bundle: Blob;
  bearerToken: string;
  proxyURL?: string;
  store?: {
    host?: string;
    assetId: string;
  };
}): Promise<ReportUploadResponseData> {
  const { bundle, bearerToken, store } = params;
  const storeHost = store?.host ?? 'store.leanix.net';
  const assetId = store?.assetId ?? null;
  const decodedToken: JwtClaims = jwtDecode(bearerToken);
  const url =
    assetId !== null
      ? `https://${storeHost}/services/torg/v1/assetversions/${assetId}/payload`
      : `${decodedToken.instanceUrl}/services/pathfinder/v1/reports/upload`;
  const form = new FormData();
  form.append('file', bundle);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearerToken}` },
    body: form
  });
  const contentType = res.headers.get('content-type');
  const content =
    contentType === 'application/json' ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error(JSON.stringify({ status: res.status, message: content }));
  }
  return content as ReportUploadResponseData;
}

export async function fetchWorkspaceReports(
  bearerToken: string
): Promise<CustomReportMetadata[]> {
  const decodedToken: JwtClaims = jwtDecode(bearerToken);
  const headers = { Authorization: `Bearer ${bearerToken}` };
  const fetchReportsPage = async (
    cursor: string | null = null
  ): Promise<ReportsResponseData> => {
    const url = new URL(
      `${decodedToken.instanceUrl}/services/pathfinder/v1/reports?sorting=updatedAt&sortDirection=DESC&pageSize=100`
    );
    if (cursor !== null) {
      url.searchParams.append('cursor', cursor);
    }
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers
    });
    return (await res.json()) as ReportsResponseData;
  };
  const reports: CustomReportMetadata[] = [];
  let cursor = null;
  do {
    const reportResponseData: ReportsResponseData =
      await fetchReportsPage(cursor);
    if (reportResponseData.status !== 'OK') {
      return await Promise.reject(reportResponseData);
    }
    reports.push(...reportResponseData.data);
    cursor =
      reports.length < reportResponseData.total
        ? reportResponseData.endCursor
        : null;
  } while (cursor !== null);
  return reports;
}

export async function deleteWorkspaceReportById(
  reportId: string,
  bearerToken: string
): Promise<204 | number> {
  const decodedToken: JwtClaims = jwtDecode(bearerToken);
  const url = new URL(
    `${decodedToken.instanceUrl}/services/pathfinder/v1/reports/${reportId}`
  );
  const { status } = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearerToken}` }
  });
  return status === 204
    ? await Promise.resolve(status)
    : await Promise.reject(status);
}

// --- v2 upload (Reports Service) ---

export async function npmPackBundle(cwd: string): Promise<string> {
  const packDir = mkdtempSync(join(tmpdir(), 'lxr-npm-pack-'));
  await execFileAsync('npm', ['shrinkwrap'], { cwd });
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--pack-destination', packDir, '--json'],
    { cwd }
  );
  const parsed = JSON.parse(stdout) as Array<{ filename: string }>;
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0]?.filename) {
    throw new Error(`unexpected npm pack output: ${stdout}`);
  }
  return resolve(packDir, parsed[0].filename);
}

function reportsServiceClient(params: {
  host: string;
  bearerToken: string;
  baseURL?: string;
}): ReturnType<typeof createClient<paths>> {
  const { host, bearerToken, baseURL } = params;
  return createClient<paths>({
    baseUrl: baseURL ?? `https://${host}/services/reports/v1`,
    headers: { Authorization: `Bearer ${bearerToken}` }
  });
}

export async function uploadReportV2(params: {
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
    throw new Error(
      JSON.stringify({ status: response.status, message: error ?? data })
    );
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
      { params: { path: { customReportVersionId } } }
    );
    if (error !== undefined || data === undefined) {
      throw new Error(
        JSON.stringify({ status: response.status, message: error })
      );
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
