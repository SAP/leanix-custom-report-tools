import type { operations } from '../generated/reports-service';

type GeneratedMetadata =
  operations['CustomReportVersionsController_getMetadata']['responses']['200']['content']['application/json'];

export type CustomReportVersionUploadResponse =
  operations['CustomReportVersionsController_upload']['responses']['201']['content']['application/json'];

// CMP-394 adds FAILED — extend until regenerated post-deploy
export type CustomReportState = GeneratedMetadata['status'] | 'FAILED';

export interface CustomReportRow {
  id: string;
  status: CustomReportState;
  // CMP-394: buildLog will be in the generated spec once deployed
  buildLog: string | null;
}

// Terminal failures: VULNERABLE (scan found issues), FAILED (build failed).
// REVOKED: revoked after being live for some time, not expected on upload time.
export const CUSTOM_REPORT_TERMINAL_FAILURE_STATES: CustomReportState[] = [
  'VULNERABLE',
  'FAILED',
  'REVOKED'
];
