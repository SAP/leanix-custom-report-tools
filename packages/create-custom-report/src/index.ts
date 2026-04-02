#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { red } from 'kolorist';
import minimist from 'minimist';
import prompts from 'prompts';
import {
  isValidPackageName,
  pkgFromUserAgent,
  toValidPackageName
} from './helpers';
import { getAccessToken } from '@lxr/core/index';
import banner from './utils/banner';
import { deployTemplate } from './utils/deployTemplate';
import { generateLeanIXFiles } from './utils/leanix';
import { generateMcpConfig } from './utils/generateMcpConfig';
import { checkFeatureFlag } from './utils/featureFlags';
import type {
  LeanIXOptions,
  ProjectOptions,
  PromptResult
} from './models/project-options';
import { parseTriStateBoolean } from './utils/parseTriStateBoolean';

export type { LeanIXOptions, ProjectOptions, PromptResult };
export { parseTriStateBoolean };

const cwd = process.cwd();

// Fixed template: React with TypeScript
const TEMPLATE = 'react-ts';

const getCredentialQuestions = (options?: {
  host?: string;
  apitoken?: string;
  proxyURL?: string;
  skipIfProvided?: boolean;
}): Array<
  prompts.PromptObject<'host' | 'apitoken' | 'behindProxy' | 'proxyURL'>
> => [
  {
    type:
      options?.skipIfProvided && options?.host !== undefined ? null : 'text',
    name: 'host',
    initial: options?.host ?? 'demo-eu.leanix.net',
    message: 'Which host do you want to work with?'
  },
  {
    type:
      options?.skipIfProvided && options?.apitoken !== undefined
        ? null
        : 'text',
    name: 'apitoken',
    message:
      'API-Token for Authentication (see: https://dev.leanix.net/docs/authentication#section-generate-api-tokens)\n  ⚠️  Security advice: API token will be persisted in the report config file'
  },
  {
    type:
      options?.skipIfProvided && options?.proxyURL !== undefined
        ? null
        : options?.skipIfProvided &&
            options?.host !== undefined &&
            options?.apitoken !== undefined
          ? null // full auth provided without proxy — skip toggle
          : 'toggle',
    name: 'behindProxy',
    message: 'Are you behind a proxy?',
    initial: !!options?.proxyURL,
    active: 'Yes',
    inactive: 'No'
  },
  {
    type: (prev: boolean) => prev && 'text',
    name: 'proxyURL',
    message: 'Proxy URL?',
    initial: options?.proxyURL
  }
];

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
  },
  ...(argv.skipAuth ? [] : getCredentialQuestions({
    host: argv?.host,
    apitoken: argv?.apitoken,
    proxyURL: argv?.proxyURL,
    skipIfProvided: true
  }))
];

export async function init(): Promise<void> {
  console.log(`\n${banner}\n`);
  const argv = minimist(process.argv.slice(2), {
    string: [
      'id',
      'author',
      'title',
      'description',
      'host',
      'apitoken',
      'proxyURL',
      'packageName'
    ],
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
  project-name            Directory name for the new project (default: leanix-custom-report)

Options:
  --id <string>           Unique report id in Java package notation (e.g. net.leanix.barcharts)
  --author <string>       Report author (e.g. LeanIX GmbH)
  --title <string>        Title shown in LeanIX when the report is installed
  --description <string>  Short description of the report
  --packageName <string>  npm package name (default: derived from project-name)
  --host <string>         LeanIX host (default: demo-eu.leanix.net)
  --apitoken <string>     API token for authentication
  --proxyURL <string>     HTTP/S proxy URL (implies proxy is in use; skips proxy prompts)
  --overwrite             Overwrite target directory if it exists (default: false)
  --skipAuth              Skip LeanIX authentication entirely (default: false)
  --setupMcpServers       Generate MCP server config files (requires feature flag)
  --no-setupMcpServers    Skip MCP server config generation without prompting
  --help                  Show this help message and exit
`);
    process.exit(0);
  }

  let targetDir = argv?._?.[0] ?? null;
  const defaultProjectName = targetDir ?? 'leanix-custom-report';

  // leanix-specific answers
  let {
    id,
    author,
    title,
    description,
    host,
    apitoken,
    proxyURL,
    packageName,
    overwrite = false
  } = argv;

  // tri-state: undefined = not supplied (will prompt), true/false = skip prompt
  let setupMcpServers = parseTriStateBoolean(
    process.argv.slice(2),
    'setupMcpServers'
  );

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

  // leanix-specific answers
  ({
    id = id,
    author = author,
    title = title,
    description = description,
    host = host,
    apitoken = apitoken,
    proxyURL = proxyURL,
    packageName = packageName,
    setupMcpServers = setupMcpServers,
    overwrite = overwrite
  } = result);
  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent) ?? null;
  const pkgManager = pkgInfo != null ? pkgInfo.name : 'npm';

  // Validate credentials by getting access token, retry if invalid
  let tokenResponse = null;
  let mcpCustomReportsEnabled = false;

  if (!argv.skipAuth) {
    while (!tokenResponse) {
      try {
        if (!host || !apitoken) {
          throw new Error('Host and API token are required');
        }
        tokenResponse = await getAccessToken({ host, apitoken, proxyURL });
        console.log('✓ Successfully authenticated with LeanIX');
      } catch (error) {
        console.log(
          `${red('✖')} Failed to authenticate: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        console.log(
          'Please check your host, API token, and proxy settings and try again.\n'
        );

        const retryResult = await prompts(
          getCredentialQuestions({ host, apitoken, proxyURL }),
          {
            onCancel: () => {
              throw new Error(`${red('✖')} Operation cancelled`);
            }
          }
        );

        host = retryResult.host;
        apitoken = retryResult.apitoken;
        proxyURL = retryResult.proxyURL;
      }
    }

    // Check feature flag from LeanIX workspace
    try {
      mcpCustomReportsEnabled = await checkFeatureFlag({
        host,
        tokenResponse,
        featureFlagId: 'mcpserver.custom-reports',
        proxyURL
      });
    } catch (error) {
      console.log(
        `${red('✖')} Could not check feature flags: ${error instanceof Error ? error?.message : 'Unknown error'}`
      );
      console.log('AGENTS.md will not be included in the generated project.\n');
      mcpCustomReportsEnabled = false;
    }

    // Ask about MCP setup only if feature flag is enabled
    if (mcpCustomReportsEnabled && setupMcpServers === undefined) {
      const mcpPromptResult = await prompts(
        {
          type: 'toggle',
          name: 'setupMcpServers',
          message:
            'Set up local MCP servers for AI development?\n  - Chrome DevTools MCP (requires Chrome browser)\n  - LeanIX MCP Server (workspace data access)\n  ⚠️  Security advice: API token will be persisted in the MCP server config files\n  Config files are gitignored and take precedence over global settings.',
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
      host,
      apitoken,
      proxyURL,
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
      host,
      apitoken,
      proxyURL,
      overwrite
    }
  });

  // Generate MCP configuration files if feature flag enabled and user opted in
  if (setupMcpServers === true && mcpCustomReportsEnabled && host && apitoken) {
    generateMcpConfig({
      targetDir: root,
      host,
      apitoken
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
}

init().catch((e) => {
  console.error(e);
});

export default init;
