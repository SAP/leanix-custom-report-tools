import zod from 'zod';

export const customReportMetadataSchema = zod.object({
  id: zod.string(),
  name: zod.string(),
  title: zod.string(),
  version: zod.string(),
  author: zod.string(),
  description: zod.string(),
  aiAssisted: zod.boolean().optional(),
  defaultConfig: zod.record(zod.string(), zod.any()).optional()
});

export type CustomReportMetadata = zod.infer<typeof customReportMetadataSchema>;
