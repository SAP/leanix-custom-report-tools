import zod from 'zod';

export const packageJsonLxrSchema = zod.object({
  name: zod.string(),
  version: zod.string(),
  description: zod.string(),
  leanixReport: zod.object({
    id: zod.string().optional(),
    title: zod.string(),
    aiAssisted: zod.boolean().optional(),
    defaultConfig: zod.record(zod.string(), zod.any()).optional()
  })
});

export type PackageJsonLXR = zod.infer<typeof packageJsonLxrSchema>;
