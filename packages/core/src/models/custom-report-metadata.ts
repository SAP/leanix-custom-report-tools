import zod from 'zod';

export const customReportMetadataSchema = zod.object({
  name: zod.string(),
  title: zod.string(),
  version: zod.string(),
  description: zod.string(),
  aiAssisted: zod.boolean().optional(),
  defaultConfig: zod.record(zod.string(), zod.any()).optional()
});

export type CustomReportMetadata = zod.infer<typeof customReportMetadataSchema>;
