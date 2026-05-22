import zod from 'zod';

export const credentialsSchema = zod.object({
  _description: zod.string().optional(),
  host: zod.string().optional(),
  apitoken: zod.string().optional(),
  proxyURL: zod.string().optional(),
  store: zod.object({
    host: zod.string().optional(),
    assetId: zod.string()
  }).optional(),
  oauth: zod.object({
    client_id: zod.string(),
    client_secret: zod.string(),
    access_token: zod.string(),
    refresh_token: zod.string(),
    expires_at: zod.number()
  }).optional()
});

export type Credentials = zod.infer<typeof credentialsSchema>;
