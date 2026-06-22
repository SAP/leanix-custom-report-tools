#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { red, yellow } from 'kolorist';
import minimist from 'minimist';
import prompts from 'prompts';
import { isValidPackageName, INVALID_PROJECT_NAME_CHARS } from './helpers';
import { authenticate } from '@lxr/core/auth';
import { getWorkspaceNameFromAccessToken } from '@lxr/core/oauth';
import {
  clearConnectionConfig,
  readConnectionConfig
} from '@lxr/core/connection-config';
import type { ConnectionConfigFile } from '@lxr/core/connection-config';
import banner from './utils/banner';
import { deployTemplate } from './utils/deployTemplate';
import { generatePackageJson } from './utils/leanix';
import { generateMcpConfig } from './utils/generateMcpConfig';
import { initProxy } from '@lxr/core/proxy';
import { getUserLxrJsonPath } from '@lxr/core/constants';
import semver from 'semver';
import pkg from '../package.json' with { type: 'json' };

if (!semver.satisfies(process.versions.node, pkg.engines.node)) {
  console.error(
    `${red('✖')} Node.js ${process.versions.node} is not supported.\nRequired: ${pkg.engines.node}`
  );
  process.exit(1);
}

const cwd = process.cwd();

// Fixed template: React with TypeScript
const TEMPLATE = 'react-ts';

// ---------------------------------------------------------------------------
// V2 auth flow
// ---------------------------------------------------------------------------

async function runV2Auth(file: ConnectionConfigFile | null): Promise<{
  host: string;
  workspaceName: string;
  configPath: string;
}> {
  const configPath = file?.path ?? getUserLxrJsonPath();
  try {
    const { bearerToken, host } = await authenticate(file);

    const workspaceName = getWorkspaceNameFromAccessToken(bearerToken);
    return { host, workspaceName, configPath };
  } catch (error) {
    // Auth failed — write proxy-only config and continue
    if (file) {
      clearConnectionConfig(file?.config, configPath);
    }
    console.log(
      `${red('✖')} ${error instanceof Error ? error.message : 'Authentication failed: unknown error'}`
    );
    console.log(
      '  Connection config written without credentials. Set up auth manually later.'
    );
    return { host: '', workspaceName: '', configPath };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function init(): Promise<void> {
  console.log(`\n${banner}\n`);
  const argv = minimist(process.argv.slice(2), {
    string: ['title', 'description', 'proxyURL'],
    boolean: ['overwrite', 'skipAuth', 'help'],
    default: {
      overwrite: false,
      skipAuth: false
    }
  });

  if (argv.help) {
    console.log(`
Usage: npm create @sap/leanix-custom-report [project-name] [options]

Arguments:
  project-name            Directory name for the new project

Options:
  --title <string>        Title shown in SAP LeanIX when the report is installed
  --description <string>  Short description of the report
  --proxyURL <string>     HTTP/S proxy URL to use for requests to SAP LeanIX
  --overwrite             Overwrite target directory if it exists (default: false)
  --skipAuth              Skip SAP LeanIX authentication entirely (default: false)
  --help                  Show this help message and exit
`);
    process.exit(0);
  }

  // Parse CLI args
  let { title, description, proxyURL, overwrite = false } = argv;

  let projectName: string | null = argv._[0] ?? null;

  if (projectName !== null && !isValidPackageName(projectName)) {
    throw new Error(
      `Invalid project name "${projectName}": ${INVALID_PROJECT_NAME_CHARS}`
    );
  }

  // Read user-level config before prompting — proxy may already be configured
  let configFile = readConnectionConfig(true);

  // Prompt for missing values
  const result: {
    projectName?: string;
    overwrite?: boolean;
    title?: string;
    description?: string;
    proxyURL?: string;
  } = {};

  try {
    console.log(
      "  The project name is your report's permanent identity in the workspace — choose it carefully.\n  Use lowercase letters, digits, dots, hyphens, or underscores (e.g. my-custom-report)."
    );

    // Loop project-name + overwrite together: declining the overwrite prompt
    // re-asks for a name instead of exiting.
    while (true) {
      const nameAnswers = await prompts(
        [
          {
            name: 'projectName',
            type: () => (projectName !== null ? null : 'text'),
            message: 'Project name:',
            validate: (v: string) => {
              if (!v || v.trim() === '') return 'Project name is required.';
              return isValidPackageName(v) || INVALID_PROJECT_NAME_CHARS;
            }
          },
          {
            name: 'overwrite',
            type: (prev) => {
              const name = projectName ?? prev ?? '';
              return !existsSync(name) || overwrite ? null : 'confirm';
            },
            message: (prev) => {
              const name = projectName ?? prev ?? '';
              return `Target directory "${name}" is not empty. Remove existing files and continue?`;
            }
          }
        ],
        {
          onCancel: () => {
            throw new Error(`${red('✖')} Operation cancelled`);
          }
        }
      );

      const chosenName = nameAnswers.projectName ?? projectName;
      const overwriteAnswer = nameAnswers.overwrite;

      // overwrite prompt skipped (dir doesn't exist or --overwrite was passed)
      // OR user accepted the overwrite
      if (overwriteAnswer === undefined || overwriteAnswer === true) {
        result.projectName = chosenName;
        result.overwrite = overwriteAnswer ?? overwrite;
        break;
      }

      // User declined → repaint the two ✔ marks on the completed prompts as
      // red ✖ to signal "these answers will be discarded", then re-ask.
      // We only overwrite the leading symbol char; the rest of each line is
      // left intact, so the trick is safe even if the message wraps.
      if (process.stdout.isTTY) {
        process.stdout.write(
          `\x1b[2A\x1b[0G${red('✖')}\x1b[1B\x1b[0G${red('✖')}\x1b[1B\x1b[0G`
        );
      }
      console.log(`${yellow('↻')} Let's try a different name.`);
      projectName = null;
    }

    const restAnswers = await prompts(
      [
        {
          type: argv?.title === undefined ? 'text' : null,
          name: 'title',
          message: 'Report title'
        },
        {
          type: argv?.description === undefined ? 'text' : null,
          name: 'description',
          message: 'Report description'
        },
        {
          type:
            argv?.proxyURL !== undefined || configFile !== null || argv.skipAuth
              ? null
              : 'toggle',
          name: 'behindProxy',
          message: 'Are you behind a proxy?',
          initial: false,
          active: 'Yes',
          inactive: 'No'
        },
        {
          type: (prev) => (prev === true ? 'text' : null),
          name: 'proxyURL',
          message: 'Proxy URL?',
          initial: argv?.proxyURL
        }
      ],
      {
        onCancel: () => {
          throw new Error(`${red('✖')} Operation cancelled`);
        }
      }
    );
    Object.assign(result, restAnswers);
  } catch (cancelled: unknown) {
    console.log(
      cancelled instanceof Error ? cancelled.message : String(cancelled)
    );
    process.exit(1);
  }

  // Merge prompt answers over CLI args
  title = result.title ?? title;
  description = result.description ?? description;
  proxyURL = result.proxyURL ?? proxyURL;
  overwrite = result.overwrite ?? overwrite;
  // Non-null assertion: the prompt loop above only exits with a validated name.
  projectName = (result.projectName ?? projectName)!;

  console.log();

  const savedProxyURL = configFile?.config.proxyURL;
  proxyURL = proxyURL ?? savedProxyURL;
  initProxy(proxyURL);

  // Auth — run OAuth flow automatically, no prompts (skipped when --skipAuth)
  if (!argv.skipAuth) {
    if (!configFile && proxyURL) {
      configFile = { config: { proxyURL }, path: getUserLxrJsonPath() };
    }
    const { host, workspaceName, configPath } = await runV2Auth(configFile);

    console.log(`  Config:    ${configPath}`);
    console.log(`  Proxy:     ${proxyURL ?? 'none'}`);
    if (host) {
      console.log(`  Host:      ${host}`);
      console.log(`  Workspace: ${workspaceName}`);
    }
  }

  // Scaffold project
  const targetDir = join(cwd, projectName);
  console.log(`\nCreating project in ${targetDir}\n`);

  if (overwrite === true) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir);
  }

  deployTemplate({
    targetDir,
    template: TEMPLATE
  });

  await generatePackageJson({
    targetDir,
    result: {
      packageName: projectName,
      title,
      description
    }
  });

  generateMcpConfig({ targetDir });
  console.log(
    '✓ MCP servers configured for GitHub Copilot (VS Code) and Claude Code:'
  );
  console.log('  - Playwright MCP (AI report verification)');
  console.log('  - SAP LeanIX MCP Server (workspace data access)');
  console.log('    The SAP LeanIX MCP Server uses its own OAuth session.');
  console.log('    When your AI tool first connects to it, a second browser');
  console.log('    login will open to authorize MCP workspace access.');
  console.log();

  // Done
  console.log();
  console.log('Done ✅');
  console.log();
  console.log(
    '  Now open the project in your IDE, install dependencies, and run it locally:'
  );
  console.log();
  console.log(`  cd ${relative(cwd, targetDir)} && code .`);
  console.log('  (or open the folder in your IDE via File > Open Folder');
  console.log(
    '  and open the integrated terminal via Terminal > New Terminal)'
  );
  console.log();
  console.log('  npm install');
  console.log('  npm run dev\n');
}

init().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

export default init;
