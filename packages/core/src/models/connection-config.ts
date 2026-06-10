import zod from 'zod';

export const connectionConfigSchema = zod.object({
  _description: zod.string().optional(),
  host: zod.string().optional(),
  apitoken: zod.string().optional(),
  proxyURL: zod.string().optional(),
  oauth: zod
    .object({
      issuer: zod.string().optional(),
      client_id: zod.string(),
      client_secret: zod.string(),
      registration_access_token: zod.string().optional(),
      access_token: zod.string(),
      refresh_token: zod.string(),
      expires_at: zod.number()
    })
    .optional()
});

export type ConnectionConfig = zod.infer<typeof connectionConfigSchema>;
