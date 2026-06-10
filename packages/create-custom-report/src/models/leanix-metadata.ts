import type { PromptResult } from './project-options';

export interface AddLeanIXMetadataToPackageJson {
  targetDir: string;
  result: PromptResult;
  isV2?: boolean;
}

export interface GenerateLeanIXFilesOutput {
  packageJson: any;
  lxrJson: any;
}
