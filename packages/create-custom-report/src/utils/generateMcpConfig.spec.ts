import { jest } from '@jest/globals';

jest.mock('node:os', () => ({ platform: jest.fn() }));
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
}));
jest.mock('node:child_process', () => ({ execFileSync: jest.fn() }));

import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { detectBrowser } from './generateMcpConfig';

const mockedPlatform = platform as jest.MockedFunction<typeof platform>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedExecFileSync = execFileSync as jest.MockedFunction<
  typeof execFileSync
>;

beforeEach(() => {
  jest.resetAllMocks();
});

describe('detectBrowser', () => {
  it('returns msedge on Windows without checking the filesystem', () => {
    mockedPlatform.mockReturnValue('win32');

    expect(detectBrowser()).toBe('msedge');
    expect(mockedExistsSync).not.toHaveBeenCalled();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('returns chrome on macOS when /Applications/Google Chrome.app exists', () => {
    mockedPlatform.mockReturnValue('darwin');
    mockedExistsSync.mockReturnValue(true);

    expect(detectBrowser()).toBe('chrome');
    expect(mockedExistsSync).toHaveBeenCalledWith(
      '/Applications/Google Chrome.app'
    );
  });

  it('falls back to chromium on macOS when Chrome.app is missing', () => {
    mockedPlatform.mockReturnValue('darwin');
    mockedExistsSync.mockReturnValue(false);

    expect(detectBrowser()).toBe('chromium');
  });

  it('returns chrome on Linux when google-chrome is on PATH', () => {
    mockedPlatform.mockReturnValue('linux');
    mockedExecFileSync.mockReturnValueOnce(Buffer.from(''));

    expect(detectBrowser()).toBe('chrome');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'which',
      ['google-chrome'],
      { stdio: 'ignore' }
    );
  });

  it('returns chrome on Linux when only google-chrome-stable is on PATH', () => {
    mockedPlatform.mockReturnValue('linux');
    mockedExecFileSync
      .mockImplementationOnce(() => {
        throw new Error('not found');
      })
      .mockReturnValueOnce(Buffer.from(''));

    expect(detectBrowser()).toBe('chrome');
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      1,
      'which',
      ['google-chrome'],
      { stdio: 'ignore' }
    );
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      2,
      'which',
      ['google-chrome-stable'],
      { stdio: 'ignore' }
    );
  });

  it('falls back to chromium on Linux when no Chrome binary is on PATH', () => {
    mockedPlatform.mockReturnValue('linux');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(detectBrowser()).toBe('chromium');
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
  });
});
