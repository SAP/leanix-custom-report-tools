import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { resolve } from 'node:path';
import { postOrderDirectoryTraverse } from './utils/directoryTraverse';

export function canSkipEmptying(dir: string): boolean {
  if (!existsSync(dir)) {
    return true;
  }

  const files = readdirSync(dir);
  if (files.length === 0) {
    return true;
  }
  if (files.length === 1 && files[0] === '.git') {
    return true;
  }

  return false;
}

export function emptyDir(dir: string): void {
  if (!existsSync(dir)) {
    return;
  }

  postOrderDirectoryTraverse(
    dir,
    (dir: string) => {
      rmdirSync(dir);
    },
    (file: string) => {
      unlinkSync(file);
    }
  );
}

export function pkgFromUserAgent(
  userAgent?: string
): { name: string; version: string } | undefined {
  if (userAgent === undefined) {
    return undefined;
  }
  const pkgSpec = userAgent.split(' ')[0];
  const pkgSpecArr = pkgSpec.split('/');
  return { name: pkgSpecArr[0], version: pkgSpecArr[1] };
}

export function copyDir(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    const srcFile = resolve(srcDir, file);
    const destFile = resolve(destDir, file);
    copy(srcFile, destFile);
  }
}

function copy(src: string, dest: string): void {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dest);
  } else {
    copyFileSync(src, dest);
  }
}

export function isValidPackageName(projectName: string): boolean {
  return /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(
    projectName
  );
}

export function toValidPackageName(projectName: string): string {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z0-9-~]+/g, '-');
}
