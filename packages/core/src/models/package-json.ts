import zod from 'zod';

export const packageJsonLxrSchema = zod.object({
  name: zod.string(),
  version: zod.string(),
  description: zod.string(),
  leanixReport: zod.object({
    title: zod.string(),
    id: zod.string().optional(), // optional report id (e.g. "net.leanix.myreport"); required by `lxr store-upload`
    aiAssisted: zod.boolean().optional(),
    defaultConfig: zod.record(zod.string(), zod.any()).optional()
  })
});

export type PackageJsonLXR = zod.infer<typeof packageJsonLxrSchema>;
