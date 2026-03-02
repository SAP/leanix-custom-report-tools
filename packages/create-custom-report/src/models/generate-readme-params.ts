export interface GenerateReadmeParams {
  projectName: string;
  packageManager: string;
  needsTypeScript?: boolean;
  needsCypress?: boolean;
  needsCypressCT?: boolean;
  needsPlaywright?: boolean;
  needsJest?: boolean;
  needsVitest?: boolean;
  needsEslint?: boolean;
  needsPrettier?: boolean;
}
