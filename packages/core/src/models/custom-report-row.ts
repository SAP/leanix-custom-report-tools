import type { components, operations } from '../generated/reports-service';

type GeneratedMetadata =
  operations['CustomReportVersionsController_getMetadata']['responses']['200']['content']['application/json'];

export type CustomReportVersionUploadResponse =
  operations['CustomReportVersionsController_upload']['responses']['201']['content']['application/json'];

export type CustomReportState = GeneratedMetadata['status'];

// The security scan block returned on GET /customReportVersions/:id.
export type SecurityScan =
  components['schemas']['CustomReportVersionMetadataDtoSecurityScan'];

export interface CustomReportRow {
  id: string;
  status: CustomReportState;
  buildLog: string | null;
  securityScan: SecurityScan | null;
}

// Happy path for an upload: SCANNING -> BUILDING -> READY.
// Terminal failures: VULNERABLE (scan found issues), FAILED (build failed).
// REVOKED: revoked after being live for some time, not expected on upload time.
export const CUSTOM_REPORT_TERMINAL_FAILURE_STATES: CustomReportState[] = [
  'VULNERABLE',
  'FAILED',
  'REVOKED'
];
