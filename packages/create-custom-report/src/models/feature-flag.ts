export interface Feature {
  id: string;
  status: string;
}

export interface FeatureBundleResponse {
  data: {
    features: Feature[];
  };
}
