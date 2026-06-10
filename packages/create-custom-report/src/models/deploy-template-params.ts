import type { PromptResult } from './project-options';

export interface DeployTemplateParams {
  targetDir: string;
  template: string;
  result: PromptResult;
  mcpCustomReportsEnabled?: boolean;
}
