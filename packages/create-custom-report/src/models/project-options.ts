export interface ProjectOptions {
  packageName?: string;
  targetDir?: string;
  overwrite?: boolean;
}

export interface LeanIXOptions {
  id?: string;
  author?: string;
  title?: string;
  description?: string;
  host?: string;
  apitoken?: string;
  proxyURL?: string;
  setupMcpServers?: boolean;
}

export interface PromptResult extends ProjectOptions, LeanIXOptions {
  projectName?: string;
}
