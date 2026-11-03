import { openAsBlob } from 'node:fs';
import { authenticate } from '@lxr/core/auth';
import {
  createBundle,
  readMetadataJson,
  uploadToExtensionHub,
  writeReportMetadata
} from '@lxr/core/index';
import { build, resolveConfig } from 'vite';

vi.mock('node:fs', () => ({ openAsBlob: vi.fn() }));
vi.mock('@lxr/core/auth', () => ({
  authenticate: vi.fn(),
  login: vi.fn(),
  logout: vi.fn()
}));
vi.mock('@lxr/core/index', () => ({
  createBundle: vi.fn(),
  readMetadataJson: vi.fn(),
  uploadToExtensionHub: vi.fn(),
  writeReportMetadata: vi.fn()
}));
vi.mock('vite', () => ({ build: vi.fn(), resolveConfig: vi.fn() }));

const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit');
  });
  vi.mocked(readMetadataJson).mockReturnValue({
    id: 'net.leanix.test',
    name: 'test-report',
    version: '1.0.0'
  } as ReturnType<typeof readMetadataJson>);
  vi.mocked(authenticate).mockResolvedValue({
    bearerToken: 'test-token'
  } as Awaited<ReturnType<typeof authenticate>>);
  vi.mocked(resolveConfig).mockResolvedValue({
    build: { outDir: 'dist' }
  } as Awaited<ReturnType<typeof resolveConfig>>);
  vi.mocked(createBundle).mockResolvedValue('bundle.tgz');
  vi.mocked(openAsBlob).mockResolvedValue(new Blob(['bundle']));
  vi.mocked(uploadToExtensionHub).mockResolvedValue({
    status: 'OK',
    type: 'ReportUploadResponseData',
    data: { id: 'report-uuid-1' }
  });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

describe('store-upload CLI', () => {
  it.each([
    [[], undefined],
    [['--store-host', 'test-exthub.leanix.net'], 'test-exthub.leanix.net']
  ])('forwards the store host for %j', async (args, host) => {
    process.argv = ['node', 'lxr', 'store-upload', 'asset-id', ...args];
    await import('./cli');
    await vi.waitFor(() => {
      expect(console.log).toHaveBeenCalledWith('Store upload complete 🚀');
    });
    expect(uploadToExtensionHub).toHaveBeenCalledExactlyOnceWith({
      assetId: 'asset-id',
      host,
      bearerToken: 'test-token',
      bundle: await vi.mocked(openAsBlob).mock.results[0].value
    });
    expect(build).toHaveBeenCalledOnce();
    expect(writeReportMetadata).toHaveBeenCalledOnce();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each([
    [[], 'Missing <asset-id> argument.'],
    [['asset-id', 'extra-arg'], 'Unexpected argument: "extra-arg".'],
    [['asset-id', '--unknown-flag'], 'Unknown option'],
    [['asset-id', '--store-host'], 'argument missing'],
    [['asset-id', '--store-host', ''], '--store-host must not be empty.'],
    [['asset-id', '--store-host', '   '], '--store-host must not be empty.']
  ])('rejects invalid arguments %j before doing work', async (args, error) => {
    process.argv = ['node', 'lxr', 'store-upload', ...args];
    await expect(import('./cli')).rejects.toThrow('process.exit');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(error));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Usage: lxr')
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(readMetadataJson).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(uploadToExtensionHub).not.toHaveBeenCalled();
  });
});
