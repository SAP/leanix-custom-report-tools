export type ResponseStatus = 'OK' | 'ERROR';

export interface PathfinderReportUploadError {
  value: 'error';
  messages: string[];
}
