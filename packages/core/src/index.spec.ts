import type { CustomReportMetadata } from '@lxr/core/models/custom-report-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ReadEntry } from 'tar';
import {
  createReadStream,
  mkdtempSync,
  openAsBlob,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import {
  createBundle,
  deleteWorkspaceReportById,
  fetchWorkspaceReports,
  getAccessToken,
  getLaunchUrl,
  npmPackBundle,
  pollReportState,
  readLxrJson,
  uploadBundle,
  uploadReportV2,
  validateDocument,
  writeReportMetadata
} from '@lxr/core/index';
import appRoot from 'app-root-path';
import { t as tarT } from 'tar';
import ProxyServer from 'transparent-proxy';

const LXR_JSON_PATH = resolve(appRoot.path, 'lxr.json');

const getDummyReportMetadata = (): CustomReportMetadata => ({
  id: 'net.testReport',
  name: 'custom-report-name',
  title: 'Test Report',
  version: '0.1.0',
  description: 'Custom Report Description',
  author: 'John Doe',
  defaultConfig: {}
});

describe('the lxr core package', () => {
  let proxy: Server;
  let proxyPort: number = 0;
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      proxy = new ProxyServer();
      proxy.listen(() => {
        proxyPort = (proxy.address() as AddressInfo).port;
        resolve();
      });
    });
  });
  afterAll(async () => {
    proxy.close();
  });

  it('validate "lxr.json" and "lxreport.json" against document schemas', async () => {
    const validMetadataDocument = getDummyReportMetadata();
    const invalidMetadataDocument = { ...validMetadataDocument, id: undefined };

    await expect(
      validateDocument(validMetadataDocument, 'lxreport.json')
    ).resolves.not.toThrow();
    await expect(
      async () =>
        await validateDocument(invalidMetadataDocument, 'lxreport.json')
    ).rejects.toThrow();
    await expect(
      validateDocument(
        { host: 'demo-us.leanix.net', apitoken: 'token' },
        'lxr.json'
      )
    ).resolves.not.toThrow();
    await expect(
      async () =>
        await validateDocument({ host: 'demo-us.leanix.net' }, 'lxr.json')
    ).rejects.toThrow();
  });

  it("readLxrJson throws error if json file doesn't have all required fields", async () => {
    await readLxrJson(LXR_JSON_PATH);
  });

  it('getAccessToken returns a token', async () => {
    const credentials = await readLxrJson(LXR_JSON_PATH);
    const accessToken = await getAccessToken(credentials);
    expect(typeof accessToken.accessToken).toBe('string'); // accessToken is a string
    expect(accessToken.accessToken).toBeTruthy();
    expect(typeof accessToken.expired).toBe('boolean');
    expect(accessToken.expired).toBe(false);
    expect(typeof accessToken.expiresIn).toBe('number');
    expect(accessToken.expiresIn > 0).toBe(true);
    expect(typeof accessToken.scope).toBe('string');
    expect(accessToken.tokenType).toBe('bearer');
  });

  it('getAccessToken with proxy returns a token', async () => {
    const credentials = await readLxrJson(LXR_JSON_PATH);
    credentials.proxyURL = `http://127.0.0.1:${proxyPort}`;
    const accessToken = await getAccessToken(credentials);
    expect(typeof accessToken.accessToken).toBe('string'); // accessToken is a string
    expect(accessToken.accessToken).toBeTruthy();
    expect(typeof accessToken.expired).toBe('boolean');
    expect(accessToken.expired).toBe(false);
    expect(typeof accessToken.expiresIn).toBe('number');
    expect(accessToken.expiresIn > 0).toBe(true);
    expect(typeof accessToken.scope).toBe('string');
    expect(accessToken.tokenType).toBe('bearer');
  });

  it('getLaunchUrl returns a url', async () => {
    const devServerUrl = 'https://localhost:8080';
    const relayServerUrl = 'http://localhost:3000';
    const expectedWorkspaceName = 'bernharddemo';
    const bearerToken =
      'eyJraWQiOiI0MDJjODg3NTBjZmJhOGQzZTQ0NjE0YzQ5YjBlYzg3NiIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiJwYXVsb0BmYXplbmRhZG9zb2Z0d2FyZS5jb20iLCJwcmluY2lwYWwiOnsiaWQiOiIyN2U0MjQyZS0xNWJiLTRlNDQtYjQxYi1hMDViYzFhMTEyMjIiLCJ1c2VybmFtZSI6InBhdWxvQGZhemVuZGFkb3NvZnR3YXJlLmNvbSIsInJvbGUiOiJBQ0NPVU5UVVNFUiIsInN0YXR1cyI6IkFDVElWRSIsImFjY291bnQiOnsiaWQiOiIzYWZhMjE2YS1hZTMxLTRjOWUtYTcyZi1hOTVjYzE4NDAxMmQiLCJuYW1lIjoiZmF6ZW5kYWRvc29mdHdhcmUifSwicGVybWlzc2lvbiI6eyJpZCI6ImQ0YmI0MTk5LTgxMmEtNDE2Ny05ZTlmLThmMGI3NWYxMTg0NCIsIndvcmtzcGFjZUlkIjoiZDBhMGEwNDQtMGQ5Ny00ZDhiLTllMmQtYzkzYTBiMTdhMWJhIiwid29ya3NwYWNlTmFtZSI6ImJlcm5oYXJkZGVtbyIsInJvbGUiOiJBRE1JTiIsImN1c3RvbWVyUm9sZXMiOm51bGwsImFjY2Vzc0NvbnRyb2xFbnRpdGllcyI6WyJCTFVFIl0sInN0YXR1cyI6IkFDVElWRSIsImFzVXNlciI6bnVsbH19LCJpc3MiOiJodHRwczovL2V1LXN2Yy5sZWFuaXgubmV0IiwianRpIjoiMTkyMGY1NzktMTU5MS00OTE2LTkzZTktYWQ5NWQyZDFkNzNkIiwiZXhwIjoxNjI5NjgwMzYwLCJpbnN0YW5jZVVybCI6Imh0dHBzOi8vYXBwLmxlYW5peC5uZXQifQ.UswqJIfuT6EG5haAt9WiOG8qRBybV62eHqIbvahZK38AafQ93QETVMbYxf3AySSAYtrElpl3N4mZHtfqJTEygVlQw9uxUQioaT6US-lR6DJK0a7HIK-ec7LHtaQXVu2IOEGgrc7frLYFJcL1zoQqxCuxzNGtgngZbVkSKInm5sQXMueTPkew20Km762a11Us0ralnzmXduIB-JGvjt-nrEgl7t7MpRD2wN9WjN-b3Yw-2sDLj8___bcVPChH93P-p6XMRne5hiHmr-JaY3w2HHQ6PLqU2cG1BMdnA6DpmStM8MRVSciBGPtgy0ovbUrxw862wK1na8F2nrFZpsf9dw';
    const launchUrl = getLaunchUrl(devServerUrl, bearerToken, relayServerUrl);
    expect(typeof launchUrl).toBe('string');
    const url = new URL(launchUrl);
    expect(url.origin).toBe(relayServerUrl);
    expect(url.pathname).toBe(`/${expectedWorkspaceName}/reporting/dev`);
    expect(url.searchParams.get('url')).toBe(devServerUrl);
    expect(url.hash).toBe(`#access_token=${bearerToken}`);
  });

  it('createProjectBundle returns a readable stream', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'createProjectBundle-'));

    const projectFiles = {
      'index.js': 'console.log("hello world")',
      'index.html': '<html><body>Hello world</body></html>'
    };

    Object.entries(projectFiles).forEach(([filename, content]) => {
      writeFileSync(resolve(outDir, filename), content);
    });

    const expectedMetadata = getDummyReportMetadata();
    writeReportMetadata(expectedMetadata, outDir);
    const bundlePath = await createBundle(outDir);
    const fileStream = createReadStream(bundlePath);

    const bundleFiles = await new Promise<Set<string>>((resolve, reject) => {
      const entries: ReadEntry[] = [];
      fileStream.on('open', () =>
        fileStream.pipe(tarT()).on('entry', (entry) => entries.push(entry))
      );
      fileStream.on('error', (err) => {
        reject(err);
      });
      fileStream.on('end', () => {
        resolve(new Set(entries.map(({ path }) => path)));
      });
    });

    const requiredFiles = new Set([
      ...Object.keys(projectFiles),
      'lxreport.json'
    ]);

    const bundleHasAllFiles = (): boolean => {
      for (const file of requiredFiles) {
        if (!bundleFiles.has(file)) {
          return false;
        }
      }
      return true;
    };

    expect(bundleFiles.size === requiredFiles.size).toBe(true);
    expect(bundleHasAllFiles()).toBe(true);

    rmSync(outDir, { recursive: true });
  });

  it('uploadBundle', async () => {
    const credentials = await readLxrJson(LXR_JSON_PATH);
    const outDir = mkdtempSync(join(tmpdir(), 'uploadBundle-'));
    const metadata = getDummyReportMetadata();

    writeFileSync(
      resolve(outDir, 'index.html'),
      '<html><body>Hi from demo project</body></html>'
    );
    writeFileSync(resolve(outDir, 'index.js'), 'console.log("hello world")');
    const { accessToken: bearerToken } = await getAccessToken(credentials);
    const reports = await fetchWorkspaceReports(bearerToken);
    const hasTestReportInWorkspace = reports.find(
      ({ id, version }) => id === metadata.id && version === metadata.version
    );
    if (hasTestReportInWorkspace !== undefined) {
      await deleteWorkspaceReportById(hasTestReportInWorkspace.id, bearerToken);
    }
    writeReportMetadata(metadata, outDir);
    const bundlePath = await createBundle(outDir);
    const bundle = await openAsBlob(bundlePath);
    const reportUploadResponseData = await uploadBundle({
      bundle,
      bearerToken
    });
    expect(reportUploadResponseData.status).toBe('OK');
    expect(reportUploadResponseData.type).toBe('ReportUploadResponseData');
    expect(typeof reportUploadResponseData.data.id).toBe('string');
    const status = await deleteWorkspaceReportById(
      reportUploadResponseData.data.id,
      bearerToken
    );
    expect(status).toBe(204);
    rmSync(outDir, { recursive: true });
  }, 60000);

  describe('v2 upload (Reports Service)', () => {
    let server: Server;
    let baseURL: string;

    it('npmPackBundle produces a tarball for a package directory', async () => {
      const pkgDir = mkdtempSync(join(tmpdir(), 'npmPackBundle-'));
      writeFileSync(
        resolve(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'lxr-test-pack-fixture',
          version: '0.0.0',
          description: 'fixture',
          author: 'tests',
          files: ['index.js']
        })
      );
      writeFileSync(resolve(pkgDir, 'index.js'), '// fixture');
      const tarballPath = await npmPackBundle(pkgDir);
      expect(tarballPath.endsWith('.tgz')).toBe(true);
      const entries: string[] = [];
      await new Promise<void>((res, rej) => {
        createReadStream(tarballPath)
          .pipe(tarT())
          .on('entry', (e: ReadEntry) => entries.push(e.path))
          .on('end', () => res())
          .on('error', rej);
      });
      expect(entries).toEqual(
        expect.arrayContaining(['package/package.json', 'package/index.js'])
      );
      rmSync(pkgDir, { recursive: true });
    }, 30000);

    it('uploadReportV2 posts multipart and parses customReportVersionId', async () => {
      let receivedAuth: string | undefined;
      let receivedContentType: string | undefined;
      let receivedBody = '';
      server = createHttpServer((req, res) => {
        receivedAuth = req.headers.authorization;
        receivedContentType = req.headers['content-type'];
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          receivedBody = Buffer.concat(chunks).toString('utf8');
          res.statusCode = 201;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({ customReportVersionId: 'uuid-123' })
          );
        });
      });
      await new Promise<void>((r) => server.listen(0, r));
      baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
      const result = await uploadReportV2({
        host: 'unused',
        bearerToken: 'test-token',
        bundle: blob,
        baseURL
      });

      expect(result.customReportVersionId).toBe('uuid-123');
      expect(receivedAuth).toBe('Bearer test-token');
      expect(receivedContentType).toMatch(/^multipart\/form-data;/);
      expect(receivedBody).toContain('name="file"');

      await new Promise<void>((r) => server.close(() => r()));
    });

    it('uploadReportV2 throws on non-2xx', async () => {
      server = createHttpServer((_req, res) => {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'unauthorized' }));
      });
      await new Promise<void>((r) => server.listen(0, r));
      baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const blob = new Blob([new Uint8Array([1])]);
      await expect(
        uploadReportV2({
          host: 'unused',
          bearerToken: 't',
          bundle: blob,
          baseURL
        })
      ).rejects.toThrow(/401/);

      await new Promise<void>((r) => server.close(() => r()));
    });

    it('pollReportState resolves on SCANNING -> BUILDING -> READY', async () => {
      const statuses = ['SCANNING', 'BUILDING', 'READY'];
      let i = 0;
      server = createHttpServer((req, res) => {
        expect(req.url).toBe('/customReportVersions/uuid-123');
        const status = statuses[Math.min(i, statuses.length - 1)];
        i++;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'uuid-123', status, buildLog: null }));
      });
      await new Promise<void>((r) => server.listen(0, r));
      baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const seen: string[] = [];
      const row = await pollReportState({
        host: 'unused',
        customReportVersionId: 'uuid-123',
        bearerToken: 't',
        baseURL,
        intervalMs: 10,
        onUpdate: (s) => seen.push(s)
      });

      expect(row.status).toBe('READY');
      expect(seen).toEqual(['SCANNING', 'BUILDING', 'READY']);

      await new Promise<void>((r) => server.close(() => r()));
    });

    it.each([
      ['VULNERABLE', /security scan found vulnerabilities/],
      ['FAILED', /build failed/]
    ])('pollReportState rejects on %s', async (status: string, expectedMessage: RegExp) => {
      server = createHttpServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'uuid-err', status, buildLog: null }));
      });
      await new Promise<void>((r) => server.listen(0, r));
      baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      await expect(
        pollReportState({
          host: 'unused',
          customReportVersionId: 'uuid-err',
          bearerToken: 't',
          baseURL,
          intervalMs: 10
        })
      ).rejects.toThrow(expectedMessage);

      await new Promise<void>((r) => server.close(() => r()));
    });

    it('pollReportState rejects on timeout', async () => {
      server = createHttpServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'uuid-stuck', status: 'BUILDING', buildLog: null }));
      });
      await new Promise<void>((r) => server.listen(0, r));
      baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      await expect(
        pollReportState({
          host: 'unused',
          customReportVersionId: 'uuid-stuck',
          bearerToken: 't',
          baseURL,
          intervalMs: 10,
          timeoutMs: 50
        })
      ).rejects.toThrow(/timed out/);

      await new Promise<void>((r) => server.close(() => r()));
    });
  });
});
