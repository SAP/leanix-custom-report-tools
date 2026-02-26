import type { RequestInit } from 'node-fetch';
import type { AccessToken } from '@lxr/core/models/access-token';
import { createProxyAgent, getAccessTokenClaims } from '@lxr/core/index';
import fetch from 'node-fetch';

interface Feature {
  id: string;
  status: string;
}

interface FeatureBundleResponse {
  data: {
    features: Feature[];
  };
}

/**
 * Check if a specific feature flag is enabled for the workspace.
 */
export async function checkFeatureFlag(options: {
  host: string;
  tokenResponse: AccessToken;
  featureFlagId: string;
  proxyURL?: string;
}): Promise<boolean> {
  const { host, tokenResponse, featureFlagId, proxyURL } = options;
  const accessToken = tokenResponse.accessToken;

  // Extract workspace ID from token claims
  const claims = getAccessTokenClaims(tokenResponse);
  const workspaceId = claims.principal?.permission?.workspaceId;

  if (!workspaceId) {
    throw new Error('Workspace ID not found in token');
  }

  // Fetch feature bundle
  const url = `https://${host}/services/mtm/v1/workspaces/${workspaceId}/featureBundle`;
  const fetchOptions: RequestInit = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  };

  if (typeof proxyURL === 'string' && proxyURL.length > 0) {
    fetchOptions.agent = createProxyAgent(proxyURL);
  }

  const response = await fetch(url, fetchOptions);
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
