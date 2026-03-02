import type { PromptResult } from './project-options';

export interface DeployTemplateParams {
  targetDir: string;
  defaultProjectName: string;
  template: string;
  result: PromptResult;
  mcpCustomReportsEnabled?: boolean;
}
