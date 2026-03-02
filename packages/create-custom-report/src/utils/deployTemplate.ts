import type { IPromptResult } from '..';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

export interface DeployTemplateParams {
  targetDir: string;
  defaultProjectName: string;
  template: string;
  result: IPromptResult;
  mcpCustomReportsEnabled?: boolean;
}

const renameFiles: Record<string, string> = {
  _gitignore: '.gitignore'
};

function copyDir(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const files = readdirSync(srcDir);
  for (const file of files) {
    const srcFile = resolve(srcDir, file);
    const destFile = resolve(destDir, file);
    copy(srcFile, destFile);
  }
}

function copy(src: string, dest: string): void {
  const _stat = statSync(src);
  if (_stat.isDirectory()) {
    copyDir(src, dest);
  } else {
    copyFileSync(src, dest);
  }
}

export function deployTemplate(params: DeployTemplateParams): void {
  const { targetDir, template, mcpCustomReportsEnabled = false } = params;
  if (targetDir === null) {
    throw new Error('invalid target dir');
  }

  const templateDir = join(__dirname, 'templates', template);
  const write = (file: string, content?: string): void => {
    const targetPath = join(targetDir, renameFiles[file] ?? file);
    if (content !== undefined) {
      writeFileSync(targetPath, content);
    } else {
      copy(join(templateDir, file), targetPath);
    }
  };

  const templateFiles = readdirSync(templateDir);
  for (const file of templateFiles /* .filter(f => f !== 'package.json') */) {
    // Skip AGENTS.md and CLAUDE.md if MCP custom reports feature is not enabled
    if (
      (file === 'AGENTS.md' || file === 'CLAUDE.md') &&
      !mcpCustomReportsEnabled
    ) {
      continue;
    }
    write(file);
  }
}
