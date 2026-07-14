import type { PackageFinding, Scan } from '@lxr/core/models/custom-report-row';
import { PACKAGE_FINDING_SEVERITIES } from '@lxr/core/models/custom-report-row';
import type { Logger } from 'vite';
import Table from 'cli-table3';

const EXPECTED_SCHEMA_VERSION = '1';
const SEVERITY_COLUMN_VALUES = [
  'Severity',
  ...PACKAGE_FINDING_SEVERITIES,
  'unknown'
] as const;
const SEVERITY_WIDTH = Math.max(...SEVERITY_COLUMN_VALUES.map((s) => s.length));
const PADDING = 2;
const FALLBACK_TERMINAL_WIDTH = 80;
const HEADERS = [
  'Severity',
  'Advisory',
  'Vulnerable Package',
  'Vulnerability',
  'Dependency Chain'
];

function severityLabel(severity: PackageFinding['severity']): string {
  return (severity ?? 'unknown').toUpperCase();
}

function buildScanHeader(scan: Scan): string {
  if (scan.packageFindings.length === 0)
    return 'Scan result: clean — no package findings.';

  const countBySeverity = scan.packageFindings.reduce<Map<string, number>>(
    (counts, finding) => {
      const severity = finding.severity ?? 'unknown';
      return counts.set(severity, (counts.get(severity) ?? 0) + 1);
    },
    new Map()
  );

  const parts = [...PACKAGE_FINDING_SEVERITIES, 'unknown']
    .filter((s) => countBySeverity.has(s))
    .map((s) => `${countBySeverity.get(s)} ${s}`);

  return `Scan result: ${parts.join(', ')}`;
}

function renderScanTable(scan: Scan, terminalWidth?: number): string[] {
  if (scan.packageFindings.length === 0) return [];

  const availableWidth =
    terminalWidth ?? process.stdout.columns ?? FALLBACK_TERMINAL_WIDTH;
  const nonContentWidth = HEADERS.length * (PADDING + 1) + 1; // padding + border per column, plus trailing border
  const contentWidth = availableWidth - nonContentWidth;

  const colWidth = Math.floor(contentWidth / HEADERS.length);
  const severityWidth = Math.min(SEVERITY_WIDTH, colWidth);
  const otherWidth = Math.floor(
    (contentWidth - severityWidth) / (HEADERS.length - 1)
  );

  const rawWidths = [
    severityWidth,
    ...Array(HEADERS.length - 1).fill(otherWidth)
  ];
  const colWidths = rawWidths.map((w) => w + PADDING);

  const table = new Table({
    head: HEADERS,
    colWidths,
    wordWrap: true,
    wrapOnWordBoundary: false
  });

  for (const f of scan.packageFindings) {
    table.push([
      severityLabel(f.severity),
      f.url ?? '',
      `${f.packageName}@${f.packageVersion}`,
      f.title ?? '(no title)',
      f.dependencyPath.length > 0
        ? [...f.dependencyPath, f.packageName].join(' > ')
        : ''
    ]);
  }

  return table.toString().split('\n');
}

export function printScanTable(logger: Logger, scan: unknown): void {
  if (
    typeof scan !== 'object' ||
    scan === null ||
    (scan as Record<string, unknown>).schemaVersion !== EXPECTED_SCHEMA_VERSION
  ) {
    logger.warn(
      `Security scan has an unexpected schema version (expected "${EXPECTED_SCHEMA_VERSION}"). Raw scan data:`
    );
    logger.info(JSON.stringify(scan, null, 2));
    return;
  }
  const typedScan = scan as Scan;
  logger.info(buildScanHeader(typedScan));
  renderScanTable(typedScan).forEach((line) => logger.info(line));
}
