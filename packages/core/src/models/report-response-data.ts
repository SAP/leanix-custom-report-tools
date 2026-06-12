import type {
  PathfinderReportUploadError,
  ResponseStatus
} from './pathfinder-response-data';

export interface ReportUploadResponseData {
  type: string;
  status: ResponseStatus;
  data: { id: string };
  errorMessage?: string;
  errors?: PathfinderReportUploadError[];
}
