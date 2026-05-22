import type { AccessToken } from '@lxr/core/models/access-token';
import type {
  CustomReportRow,
  CustomReportState,
  CustomReportVersionUploadResponse
} from '@lxr/core/models/custom-report-row';
import type { CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import type { LeanIXCredentials } from '@lxr/core/models/leanix-credentials';
import type { PackageJsonLXR } from '@lxr/core/models/package-json';
import type {
  ReportUploadResponseData,
  ReportsResponseData
} from '@lxr/core/models/report-response-data';
import type { RequestInit } from 'node-fetch';
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
import { leanixCredentialsSchema } from '@lxr/core/models/leanix-credentials';
import { packageJsonLxrSchema } from '@lxr/core/models/package-json';
import { FormData } from 'formdata-node';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { jwtDecode } from 'jwt-decode';
import fetch from 'node-fetch';
import { c } from 'tar';

const execFileAsync = promisify(execFile);

const snakeToCamel = (s: string): string =>
  s.replace(/([-_]\w)/g, (g) => g[1].toUpperCase());

export async function validateDocument(
  document: unknown,
  name: 'lxr.json' | 'lxreport.json' | 'package.json'
): Promise<PackageJsonLXR | LeanIXCredentials | CustomReportMetadata> {
  let schema: ZodObject<any>;
  let output: PackageJsonLXR | LeanIXCredentials | CustomReportMetadata;
  switch (name) {
    case 'package.json':
      schema = packageJsonLxrSchema;
      output = document as PackageJsonLXR;
      break;
    case 'lxr.json':
      schema = leanixCredentialsSchema;
      output = document as LeanIXCredentials;
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

export async function readLxrJson(path?: string): Promise<LeanIXCredentials> {
  if ((path ?? '').length === 0) {
    path = join(process.cwd(), 'lxr.json');
  }
  const {
    host,
    apitoken,
    proxyURL = null,
    store = null
  } = JSON.parse(path !== undefined ? readFileSync(path).toString() : '{}');
  const credentials: LeanIXCredentials = { host, apitoken };
  if (proxyURL !== null) {
    credentials.proxyURL = proxyURL;
  }
  if (store !== null) {
    credentials.store = store;
  }
  await validateDocument(credentials, 'lxr.json');
  return credentials;
}

export async function readMetadataJson(
  path = join(process.cwd(), 'package.json')
): Promise<CustomReportMetadata> {
  const fileContent = readFileSync(path).toString();
  const pkg: PackageJsonLXR = JSON.parse(fileContent);
  await validateDocument(pkg, 'package.json');
  const { name, version, author, description, leanixReport } = pkg;
  const metadata: CustomReportMetadata = {
    name,
    version,
    author,
    description,
    ...leanixReport
  };
  await validateDocument(metadata, 'lxreport.json');
  return metadata;
}

export function createProxyAgent(proxyURL: string): HttpsProxyAgent<string> {
  return new HttpsProxyAgent(new URL(proxyURL));
}

export async function getAccessToken(
  credentials: LeanIXCredentials
): Promise<AccessToken> {
  const uri = `https://${credentials.host}/services/mtm/v1/oauth2/token?grant_type=client_credentials`;
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${Buffer.from(`apitoken:${credentials.apitoken}`).toString('base64')}`
  };
  const options: RequestInit = { method: 'post', headers };
  if (
    typeof credentials.proxyURL === 'string' &&
    credentials.proxyURL.length > 0
  ) {
    options.agent = createProxyAgent(credentials.proxyURL);
  }
  const accessToken: AccessToken = await fetch(uri, options)
    .then(async (res) => {
      const content =
        await res[
          res.headers.get('content-type') === 'application/json'
            ? 'json'
            : 'text'
        ]();
      return res.ok ? content : await Promise.reject(res.status);
    })
    .then((accessToken) =>
      Object.entries(accessToken as AccessToken).reduce(
        (accumulator, [key, value]) => ({
          ...accumulator,
          [snakeToCamel(key)]: value
        }),
        {
          accessToken: '',
          expired: false,
          expiresIn: 0,
          scope: '',
          tokenType: ''
        }
      )
    );
  return accessToken;
}

export function getAccessTokenClaims(accessToken: AccessToken): JwtClaims {
  return jwtDecode(accessToken.accessToken);
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
  const { bundle, bearerToken, proxyURL, store } = params;
  const storeHost = store?.host ?? 'store.leanix.net';
  const assetId = store?.assetId ?? null;
  const decodedToken: JwtClaims = jwtDecode(bearerToken);
  const url =
    assetId !== null
      ? `https://${storeHost}/services/torg/v1/assetversions/${assetId}/payload`
      : `${decodedToken.instanceUrl}/services/pathfinder/v1/reports/upload`;
  const headers = { Authorization: `Bearer ${bearerToken}` };
  const form = new FormData();

  form.append('file', bundle);
  const options: RequestInit = { method: 'post', headers, body: form };
  if (typeof proxyURL === 'string' && proxyURL.length > 0) {
    options.agent = createProxyAgent(proxyURL);
  }
  const reportResponseData: ReportUploadResponseData = await fetch(
    url,
    options
  ).then(async (res) => {
    const contentType: string | null = res.headers.get('content-type');
    const content =
      contentType === 'application/json' ? await res.json() : await res.text();
    if (!res.ok) {
      throw new Error(JSON.stringify({ status: res.status, message: content }));
    }
    return content as ReportUploadResponseData;
  });
  return reportResponseData;
}

export async function fetchWorkspaceReports(
  bearerToken: string,
  proxyURL?: string
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
    const options: RequestInit = { method: 'get', headers };
    if (proxyURL !== undefined) {
      options.agent = createProxyAgent(proxyURL);
    }
    const reportsPage: ReportsResponseData = await fetch(
      url.toString(),
      options
    ).then(async (res) => (await res.json()) as ReportsResponseData);
    return reportsPage;
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
  bearerToken: string,
  proxyURL?: string
): Promise<204 | number> {
  const decodedToken: JwtClaims = jwtDecode(bearerToken);
  const headers = { Authorization: `Bearer ${bearerToken}` };
  const url = new URL(
    `${decodedToken.instanceUrl}/services/pathfinder/v1/reports/${reportId}`
  );
  const options: RequestInit = { method: 'delete', headers };
  if (proxyURL !== undefined) {
    options.agent = createProxyAgent(proxyURL);
  }
  const status = await fetch(url.toString(), options).then(
    ({ status }) => status
  );
  return status === 204
    ? await Promise.resolve(status)
    : await Promise.reject(status);
}

// --- v2 upload (Reports Service) ---

export async function npmPackBundle(cwd: string): Promise<string> {
  const packDir = mkdtempSync(join(tmpdir(), 'lxr-npm-pack-'));
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

export async function uploadReportV2(params: {
  host: string;
  bearerToken: string;
  bundle: Blob;
  proxyURL?: string;
  baseURL?: string;
}): Promise<CustomReportVersionUploadResponse> {
  const { host, bearerToken, bundle, proxyURL, baseURL } = params;
  const root = baseURL ?? `https://${host}/services/reports/v1`;
  const url = `${root}/customReportVersions/upload`;
  const headers = { Authorization: `Bearer ${bearerToken}` };
  const form = new FormData();
  form.append('file', bundle);
  const options: RequestInit = { method: 'post', headers, body: form };
  if (typeof proxyURL === 'string' && proxyURL.length > 0) {
    options.agent = createProxyAgent(proxyURL);
  }
  return await fetch(url, options).then(async (res) => {
    const contentType: string | null = res.headers.get('content-type');
    const content =
      contentType === 'application/json' ? await res.json() : await res.text();
    if (!res.ok) {
      throw new Error(JSON.stringify({ status: res.status, message: content }));
    }
    return content as CustomReportVersionUploadResponse;
  });
}

// NOTE: until the upload endpoint also returns `customReportId`, callers may
// pass the `customReportVersionId` here as a stand-in.
export async function pollReportState(params: {
  host: string;
  customReportId: string;
  bearerToken: string;
  proxyURL?: string;
  onUpdate?: (state: CustomReportState) => void;
  intervalMs?: number;
  timeoutMs?: number;
  baseURL?: string;
}): Promise<CustomReportRow> {
  const {
    host,
    customReportId,
    bearerToken,
    proxyURL,
    onUpdate,
    intervalMs = 2000,
    timeoutMs = 5 * 60 * 1000,
    baseURL
  } = params;
  const root = baseURL ?? `https://${host}/services/reports/v1`;
  const url = `${root}/customReports/${customReportId}`;
  const headers = { Authorization: `Bearer ${bearerToken}` };
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + timeoutMs;
  let lastState: CustomReportState | null = null;
  while (Date.now() < deadline) {
    const options: RequestInit = { method: 'get', headers };
    if (typeof proxyURL === 'string' && proxyURL.length > 0) {
      options.agent = createProxyAgent(proxyURL);
    }
    const row = await fetch(url, options).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(JSON.stringify({ status: res.status, message: text }));
      }
      return (await res.json()) as CustomReportRow;
    });
    if (row.state !== lastState) {
      lastState = row.state;
      onUpdate?.(row.state);
    }
    if (row.state === 'READY') {
      return row;
    }
    if (CUSTOM_REPORT_TERMINAL_FAILURE_STATES.includes(row.state)) {
      const reason =
        row.state === 'VULNERABLE'
          ? 'security scan found vulnerabilities'
          : row.state === 'FAILED'
            ? 'build failed'
            : 'report was revoked';
      throw new Error(
        row.errorMessage
          ? `${row.state}: ${reason} — ${row.errorMessage}`
          : `${row.state}: ${reason}`
      );
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for report ${customReportId} to reach ready state (last state: ${lastState ?? 'unknown'})`
  );
}
