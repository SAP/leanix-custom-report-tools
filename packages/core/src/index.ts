import type { AccessToken } from '@lxr/core/models/access-token';
import { customReportMetadataSchema, type CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { Credentials } from './models/leanix-credentials';
import type { JwtClaims } from '@lxr/core/models/jwt-claims';
import type {
  ReportUploadResponseData,
  ReportsResponseData
} from '@lxr/core/models/report-response-data';
import type { RequestInit } from 'node-fetch';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { FormData } from 'formdata-node';
import { jwtDecode } from 'jwt-decode';
import fetch from 'node-fetch';
import { c } from 'tar';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { PackageJsonLXR, packageJsonLxrSchema } from './models/package-json';

export type { ResolvedAuth } from './auth';
export type { Credentials } from './models/leanix-credentials';

export { EXP_BUFFER_SECONDS, resolveAccessToken } from './auth';
export {
  readCredentials,
  saveCredentials,
  clearCredentials
} from './credentials';
export { LXR_JSON_FILENAME, getProjectLxrJsonPath, getUserLxrJsonPath } from './constants';
export {
  deriveCodeChallenge,
  generateCodeVerifier,
  getHostFromAccessToken,
  openBrowser,
  refreshAccessToken,
  registerOAuthClient,
  runOAuthFlow,
  startCallbackServer
} from './oauth';

export function createProxyAgent(proxyURL: string): HttpsProxyAgent<string> {
  return new HttpsProxyAgent(new URL(proxyURL));
}

const snakeToCamel = (s: string): string =>
  s.replace(/([-_]\w)/g, (g) => g[1].toUpperCase());

export function readMetadataJson(path: string): CustomReportMetadata {
  const pkg: PackageJsonLXR = packageJsonLxrSchema.parse(
    JSON.parse(readFileSync(path, 'utf8'))
  );
  const { name, version, author, description, leanixReport } = pkg;
  return customReportMetadataSchema.parse({ name, version, author, description, ...leanixReport });
}

export async function getAccessToken(
  credentials: Credentials
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
}): Promise<ReportUploadResponseData> {
  const { bundle, bearerToken, proxyURL } = params;
  const decodedToken: JwtClaims = jwtDecode(bearerToken);
  const url = `${decodedToken.instanceUrl}/services/pathfinder/v1/reports/upload`;
  const headers = { Authorization: `Bearer ${bearerToken}` };
  const form = new FormData();

  form.append('file', bundle);
  const options: RequestInit = { method: 'post', headers, body: form as any };
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
