// Happy path for an upload: SCANNING -> BUILDING -> READY.
// Terminal failures: VULNERABLE (scan found issues), FAILED (build failed).
// REVOKED: revoked after being live for some time, not expected on upload time.
export type CustomReportState =
  | 'SCANNING'
  | 'BUILDING'
  | 'READY'
  | 'REVOKED'
  | 'VULNERABLE'
  | 'FAILED';

export const CUSTOM_REPORT_TERMINAL_FAILURE_STATES: CustomReportState[] = [
  'VULNERABLE',
  'FAILED',
  'REVOKED'
];

export interface CustomReportRow {
  id: string;
  state: CustomReportState;
  errorMessage?: string;
}

export interface CustomReportVersionUploadResponse {
  customReportVersionId: string;
}
