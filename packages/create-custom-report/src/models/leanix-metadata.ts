import type { PromptResult } from './project-options';

export interface AddLeanIXMetadataToPackageJson {
  targetDir: string;
  result: PromptResult;
}

export interface GenerateLeanIXFilesOutput {
  packageJson: any;
  lxrJson: any;
}
