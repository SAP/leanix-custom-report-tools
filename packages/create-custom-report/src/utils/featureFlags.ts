import type { FeatureBundleResponse } from '../models/feature-flag';
import { decodeBearerToken } from '@lxr/core/index';
import { fetch as undiciFetch } from 'undici';

export async function checkFeatureFlag(options: {
  host: string;
  accessToken: string;
  featureFlagId: string;
}): Promise<boolean> {
  const { host, accessToken, featureFlagId } = options;

  // Extract workspace ID from token claims
  const claims = decodeBearerToken(accessToken);
  const workspaceId = claims.principal?.permission?.workspaceId;

  if (!workspaceId) {
    throw new Error('Workspace ID not found in token');
  }

  // Fetch feature bundle
  const url = `https://${host}/services/mtm/v1/workspaces/${workspaceId}/featureBundle`;
  const response = await undiciFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(
      `Failed to get feature bundle: ${response.status} ${response.statusText}`
    );
  }
  const featureBundle = (await response.json()) as FeatureBundleResponse;

  // Find the specific feature
  const feature = featureBundle.data?.features?.find(
    (f) => f.id === featureFlagId
  );
  if (!feature) {
    return false;
  }
  return feature.status === 'ENABLED';
}
