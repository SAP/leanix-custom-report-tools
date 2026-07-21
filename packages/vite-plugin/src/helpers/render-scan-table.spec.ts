import type {
  PackageFinding,
  SecurityScan
} from '@lxr/core/models/custom-report-row';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'vite';
import { printScanTable } from './render-scan-table';

function makeFinding(overrides: Partial<PackageFinding> = {}): PackageFinding {
  return {
    packageName: 'some-pkg',
    packageVersion: '1.0.0',
    severity: 'high',
    title: 'A vulnerability',
    url: 'https://example.com/cve-1',
    dependencyPath: ['my-report', 'some-pkg'],
    ...overrides
  };
}

function makeScan(findings: PackageFinding[]): SecurityScan {
  return { schemaVersion: '1', packageFindings: findings };
}

function makeLogger(): {
  logger: Logger;
  infoLines: string[];
  warnLines: string[];
} {
  const infoLines: string[] = [];
  const warnLines: string[] = [];
  const logger = {
    info: (msg: string) => infoLines.push(msg),
    warn: (msg: string) => warnLines.push(msg),
    error: vi.fn(),
    clearScreen: vi.fn(),
    hasWarnings: false,
    hasErrorLogged: vi.fn(),
    warnOnce: vi.fn()
  } as unknown as Logger;
  return { logger, infoLines, warnLines };
}

/**
 * Capture every line printScanTable emits to its logInfo callback.
 * printScanTable is the only exported surface; renderScanTable and
 * buildScanHeader are intentionally private and tested through here.
 *
 * We assert on the RAW output (no ANSI stripping): severity labels are
 * rendered plain by design, so any escape byte in the output is itself a
 * regression worth catching.
 */
function capture(scan: unknown): {
  lines: string[];
  joined: string;
  header: string;
  warnLines: string[];
} {
  const { logger, infoLines, warnLines } = makeLogger();
  printScanTable(logger, scan);
  return {
    lines: infoLines,
    joined: infoLines.join('\n'),
    header: infoLines[0],
    warnLines
  };
}

describe('printScanTable', () => {
  it('prints only the clean header when there are no findings', () => {
    const { lines, header } = capture(makeScan([]));
    expect(header).toBe('Scan result: clean — no package findings.');
    expect(lines).toHaveLength(1); // header only, no table
  });

  it('prints a header followed by table lines when findings exist', () => {
    const { lines, header } = capture(makeScan([makeFinding()]));
    expect(header.startsWith('Scan result:')).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('renders the severity label and package string for each finding', () => {
    const { joined } = capture(
      makeScan([
        makeFinding({
          severity: 'critical',
          packageName: 'lib-a',
          packageVersion: '2.0.0'
        }),
        makeFinding({
          severity: 'low',
          packageName: 'lib-b',
          packageVersion: '3.1.0'
        })
      ])
    );
    expect(joined).toContain('CRITICAL');
    expect(joined).toContain('lib-a@2.0.0');
    expect(joined).toContain('LOW');
    expect(joined).toContain('lib-b@3.1.0');
  });

  it('null title renders ---; undefined url renders empty (never "undefined")', () => {
    const { joined } = capture(
      makeScan([makeFinding({ title: null, url: undefined })])
    );
    expect(joined).toContain('---');
    expect(joined).not.toContain('undefined');
  });

  it('null severity renders UNKNOWN', () => {
    const { joined } = capture(makeScan([makeFinding({ severity: null })]));
    expect(joined).toContain('UNKNOWN');
  });

  it('falls back to a sane width when process.stdout.columns is undefined (no NaN)', () => {
    vi.stubEnv('COLUMNS', '');
    const originalColumns = Object.getOwnPropertyDescriptor(
      process.stdout,
      'columns'
    );
    Object.defineProperty(process.stdout, 'columns', {
      value: undefined,
      configurable: true
    });
    try {
      const { joined, lines } = capture(makeScan([makeFinding()]));
      expect(lines.length).toBeGreaterThan(1);
      expect(joined).not.toContain('NaN');
    } finally {
      if (originalColumns) {
        Object.defineProperty(process.stdout, 'columns', originalColumns);
      }
      vi.unstubAllEnvs();
    }
  });

  it('warns and pretty-prints JSON when schemaVersion is unexpected', () => {
    const unknownScan = { schemaVersion: '2', packageFindings: [] };
    const { warnLines, lines } = capture(unknownScan);
    expect(warnLines[0]).toContain('"1"');
    expect(lines[0]).toContain('"schemaVersion": "2"');
  });
});
