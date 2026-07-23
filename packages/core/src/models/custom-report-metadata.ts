import zod from 'zod';

export const customReportMetadataSchema = zod.object({
  name: zod.string(),
  title: zod.string(),
  version: zod.string(),
  description: zod.string(),
  id: zod.string().optional(), // optional report id (e.g. "net.leanix.myreport"); required by `lxr store-upload`
  aiAssisted: zod.boolean().optional(),
  defaultConfig: zod.record(zod.string(), zod.any()).optional()
});

export type CustomReportMetadata = zod.infer<typeof customReportMetadataSchema>;
