#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { red } from 'kolorist';
import minimist from 'minimist';
import prompts from 'prompts';
import { getUserLxrJsonPath } from '@lxr/core/index';
import {
  isValidPackageName,
  pkgFromUserAgent,
  toValidPackageName
} from './helpers';
import banner from './utils/banner';
import { deployTemplate } from './utils/deployTemplate';
import { generateLeanIXFiles } from './utils/leanix';
import { generateMcpConfig } from './utils/generateMcpConfig';
import type {
  LeanIXOptions,
  ProjectOptions,
  PromptResult
} from './models/project-options';

export type { LeanIXOptions, ProjectOptions, PromptResult };

const cwd = process.cwd();

// Fixed template: React with TypeScript
const TEMPLATE = 'react-ts';

const getLeanIXQuestions = (
  argv: minimist.ParsedArgs
): Array<prompts.PromptObject<keyof LeanIXOptions | 'behindProxy'>> => [
  {
    type: argv?.id === undefined ? 'text' : null,
    name: 'id',
    message:
      'Unique id for this report in Java package notation (e.g. net.leanix.barcharts)'
  },
  {
    type: argv?.author === undefined ? 'text' : null,
    name: 'author',
    message: 'Who is the author of this report (e.g. LeanIX GmbH)'
  },
  {
    type: argv?.title === undefined ? 'text' : null,
    name: 'title',
    message: 'A title to be shown in LeanIX when report is installed'
  },
  {
    type: argv?.description === undefined ? 'text' : null,
    name: 'description',
    message: 'Description of your project'
  }
];

export async function init(): Promise<void> {
  console.log(`\n${banner}\n`);
  const argv = minimist(process.argv.slice(2), {
    string: ['id', 'author', 'title', 'description', 'packageName', 'host', 'apitoken', 'proxyURL'],
    boolean: ['overwrite', 'help', 'skipAuth'],
    default: {
      overwrite: false
    }
  });

  if (argv.help) {
    console.log(`
Usage: npm create @sap/leanix-custom-report [project-name] [options]

Arguments:
  project-name            Directory name for the new project (default: leanix-custom-report)

Options:
  --id <string>           Unique report id in Java package notation (e.g. net.leanix.barcharts)
  --author <string>       Report author (e.g. LeanIX GmbH)
  --title <string>        Title shown in LeanIX when the report is installed
  --description <string>  Short description of the report
  --packageName <string>  npm package name (default: derived from project-name)
  --host <string>         LeanIX workspace host (e.g. demo-eu.leanix.net)
  --apitoken <string>     LeanIX API token for authentication
  --proxyURL <string>     HTTP proxy URL (e.g. http://proxy.example.com:8080)
  --skipAuth              Write lxr.json directly from --host/--apitoken without OAuth flow
  --overwrite             Overwrite target directory if it exists (default: false)
  --help                  Show this help message and exit
`);
    process.exit(0);
  }

  let targetDir = argv?._?.[0] ?? null;
  const defaultProjectName = targetDir ?? 'leanix-custom-report';

  let {
    id,
    author,
    title,
    description,
    packageName,
    overwrite = false,
    host,
    apitoken,
    proxyURL
  } = argv;
  const { localCliPath } = argv;

  let result: PromptResult = {};
  try {
    result = await prompts(
      [
        {
          type: targetDir !== null ? null : 'text',
          name: 'projectName',
          message: 'Project name:',
          initial: defaultProjectName,
          onState: (state) =>
            (targetDir = state.value.trim() ?? defaultProjectName)
        },
        {
          name: 'overwrite',
          type: () => (!existsSync(targetDir) || overwrite ? null : 'confirm'),
          message: () => {
            const dirForPrompt =
              targetDir === '.'
                ? 'Current directory'
                : `Target directory "${targetDir}"`;
            return `${dirForPrompt} is not empty. Remove existing files and continue?`;
          }
        },
        {
          name: 'overwriteChecker',
          type: (_, { overwrite }: { overwrite?: boolean }) => {
            if (overwrite === false) {
              throw new Error(`${red('✖')} Operation cancelled`);
            }
            return null;
          }
        },
        {
          name: 'packageName',
          type: () =>
            isValidPackageName(targetDir) || packageName !== undefined
              ? null
              : 'text',
          message: 'Package name:',
          initial: () => toValidPackageName(targetDir),
          validate: (dir) =>
            isValidPackageName(dir) ?? 'Invalid package.json name'
        },
        ...getLeanIXQuestions(argv)
      ],
      {
        onCancel: () => {
          throw new Error(`${red('✖')} Operation cancelled`);
        }
      }
    );
  } catch (cancelled: any) {
    console.log(cancelled?.message);
    process.exit(1);
  }

  ({
    id = id,
    author = author,
    title = title,
    description = description,
    packageName = packageName,
    host = host,
    apitoken = apitoken,
    proxyURL = proxyURL,
    setupMcpServers = setupMcpServers,
    overwrite = overwrite
  } = result);
  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent) ?? null;
  const pkgManager = pkgInfo != null ? pkgInfo.name : 'npm';

  // Try feature flag check using existing credentials from ~/.leanix/credentials
  let mcpCustomReportsEnabled = false;
  const existingCreds = readUserCredentials();
  if (existingCreds?.host && existingCreds.oauth?.access_token) {
    const fakeAccessToken: AccessToken = {
      accessToken: existingCreds.oauth.access_token,
      expired: false,
      expiresIn: 0,
      scope: '',
      tokenType: 'Bearer'
    };
    try {
      mcpCustomReportsEnabled = await checkFeatureFlag({
        host: existingCreds.host,
        tokenResponse: fakeAccessToken,
        featureFlagId: 'mcpserver.custom-reports'
      });
    } catch {
      mcpCustomReportsEnabled = false;
    }
  }

  // Ask about MCP setup only if feature flag is enabled
  if (mcpCustomReportsEnabled && setupMcpServers === undefined) {
    const mcpPromptResult = await prompts(
      {
        type: 'toggle',
        name: 'setupMcpServers',
        message:
          'Set up local MCP servers for AI development?\n  - Chrome DevTools MCP (requires Chrome browser)\n  - LeanIX MCP Server (workspace data access)\n  Config files are gitignored and take precedence over global settings.',
        initial: true,
        active: 'Yes',
        inactive: 'No'
      },
      {
        onCancel: () => {
          throw new Error(`${red('✖')} Operation cancelled`);
        }
      }
    );
    setupMcpServers = mcpPromptResult.setupMcpServers;
  }

  const root = join(cwd, targetDir ?? '');

  console.log(`🚀Scaffolding project in ${root}...`);
  console.log(`Using React + TypeScript template`);

  if (overwrite === true) {
    rmSync(root, { recursive: true, force: true });
  }
  if (!existsSync(root)) {
    mkdirSync(root);
  }

  deployTemplate({
    defaultProjectName,
    targetDir: root,
    template: TEMPLATE,
    result: {
      id,
      author,
      title,
      description,
      overwrite
    },
    mcpCustomReportsEnabled: mcpCustomReportsEnabled
  });
  await generateLeanIXFiles({
    targetDir: root,
    result: {
      packageName: packageName ?? defaultProjectName,
      id,
      author,
      title,
      description,
      overwrite,
      host,
      apitoken,
      proxyURL
    }
  });

  // Generate MCP configuration files if feature flag enabled and user opted in
  if (setupMcpServers === true && mcpCustomReportsEnabled && existingCreds?.host) {
    generateMcpConfig({
      targetDir: root,
      host: existingCreds.host
    });
  }

  console.log('\n🔥Done. Now run:\n');
  if (root !== cwd) {
    console.log(`  cd ${relative(cwd, root)}`);
  }
  switch (pkgManager) {
    case 'yarn':
      console.log('  yarn');
      console.log('  yarn dev');
      break;
    default:
      console.log(`  ${pkgManager} install`);
      console.log(`  ${pkgManager} run dev`);
      break;
  }
  console.log();

  // MCP setup status
  if (setupMcpServers === false) {
    console.log('ℹ️  MCP servers not configured - you can set up manually later.');
    console.log('   See https://help.sap.com/docs/leanix/ea/mcp-server for setup instructions.');
    console.log();
  } else if (setupMcpServers === true) {
    console.log('✓ MCP servers configured (.vscode/mcp.json, .mcp.json)');
    console.log('  Supports: GitHub Copilot (VS Code) and Claude Code');
    console.log('  - Chrome DevTools MCP (AI report verification)');
    console.log('  - LeanIX MCP Server (workspace data access)');
    console.log();
  }

  // Post-scaffold login prompt (task 6.3)
  const credentialsPath = join(homedir(), '.leanix', 'credentials');
  if (!existsSync(credentialsPath)) {
    console.log(
      'To use npm run dev or npm run upload, log in to your LeanIX workspace first. Run: npm run login'
    );
    console.log();
  }
}

init().catch((e) => {
  console.error(e);
});

export default init;
