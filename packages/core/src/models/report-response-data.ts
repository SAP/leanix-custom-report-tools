import type { CustomReportMetadata } from './custom-report-metadata';
import type {
  PathfinderReportUploadError,
  PathfinderResponseData,
  ResponseStatus
} from './pathfinder-response-data';

export type ReportsResponseData = {
  data: CustomReportMetadata[];
  total: number;
  endCursor: string;
} & PathfinderResponseData;

export interface ReportUploadResponseData {
  type: string;
  status: ResponseStatus;
  data: { id: string };
  errorMessage?: string;
  errors?: PathfinderReportUploadError[];
}
