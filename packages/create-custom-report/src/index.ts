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
import { exchangeApiToken, authenticate } from '@lxr/core/auth';
import { getWorkspaceNameFromAccessToken } from '@lxr/core/oauth';
import {
  clearConnectionConfig,
  readConnectionConfig
} from '@lxr/core/connection-config';
import type { ConnectionConfigFile } from '@lxr/core/connection-config';
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
import { initProxy } from '@lxr/core/proxy';
import { getUserLxrJsonPath } from '@lxr/core/constants';
export type { LeanIXOptions, ProjectOptions, PromptResult };
export { parseTriStateBoolean };

const cwd = process.cwd();

// Fixed template: React with TypeScript
const TEMPLATE = 'react-ts';

// ---------------------------------------------------------------------------
// V1 helpers (unchanged)
// ---------------------------------------------------------------------------

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
    message: 'Which workspace instance? (e.g. demo-eu-1.leanix.net)'
  },
  {
    type:
      options?.skipIfProvided && options?.apitoken !== undefined
        ? null
        : 'text',
    name: 'apitoken',
    message:
      'Technical User Token (see: https://help.sap.com/docs/leanix/ea/technical-users)\n  ⚠️  Security notice: Technical User Token will be persisted in the report config file'
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
  argv: minimist.ParsedArgs,
  isV2: boolean
): Array<prompts.PromptObject<keyof LeanIXOptions | 'behindProxy'>> => [
  ...(isV2
    ? []
    : [
        {
          type: (argv?.id === undefined ? 'text' : null) as 'text' | null,
          name: 'id' as const,
          message:
            'Unique id for this report in Java package notation (e.g. net.leanix.barcharts)'
        }
      ]),
  {
    type: argv?.author === undefined ? 'text' : null,
    name: 'author',
    message: 'Author of the report (e.g. Jane Doe)'
  },
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
  ...(argv.skipAuth
    ? []
    : getCredentialQuestions({
        host: argv?.host,
        apitoken: argv?.apitoken,
        proxyURL: argv?.proxyURL,
        skipIfProvided: true
      }))
];

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
      `${red('✖')} Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    console.log(
      'Connection config written without credentials. Set up auth manually later.'
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
    boolean: ['overwrite', 'skipAuth', 'help', 'v2'],
    default: {
      v2: false,
      overwrite: false,
      skipAuth: false
    }
  });

  const isV2: boolean = argv.v2;

  if (argv.help) {
    console.log(`
Usage: npm create @sap/leanix-custom-report [project-name] [options]

Arguments:
  project-name            Directory name for the new project (default: leanix-custom-report)

Options:
  --id <string>           Unique report id in Java package notation (e.g. net.leanix.barcharts)
  --author <string>       Report author (e.g. SAP LeanIX)
  --title <string>        Title shown in SAP LeanIX when the report is installed
  --description <string>  Short description of the report
  --packageName <string>  npm package name (default: derived from project-name)
  --host <string>         SAP LeanIX host (default: demo-eu.leanix.net)
  --apitoken <string>     API token for authentication
  --proxyURL <string>     HTTP/S proxy URL to use for requests to SAP LeanIX
  --overwrite             Overwrite target directory if it exists (default: false)
  --skipAuth              Skip SAP LeanIX authentication entirely (default: false)
  --v2                    Use new creation UX (package name as report identity, no report ID)
  --setupMcpServers       Generate MCP server config files (requires feature flag)
  --no-setupMcpServers    Skip MCP server config generation without prompting
  --help                  Show this help message and exit
`);
    process.exit(0);
  }

  let targetDir = argv._[0] ?? null;

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

  // -------------------------------------------------------------------------
  // V2 path
  // -------------------------------------------------------------------------
  if (isV2) {
    // Read user-level config before prompting — proxy may already be configured
    let configFile = readConnectionConfig(true);

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
            type: () =>
              !existsSync(targetDir ?? '') || overwrite ? null : 'confirm',
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
            type: () => (packageName !== undefined ? null : 'text'),
            message:
              'Package name (the report identity, used together with version to uniquely identify a report in a workspace)',
            validate: (dir) =>
              isValidPackageName(dir) ||
              'Invalid package name, may only contain lowercase letters (a-z), digits (0-9), dots (.), underscores (_), and minus (-)'
          },
          {
            type: argv?.author === undefined ? 'text' : null,
            name: 'author',
            message: 'Author of the report (e.g. Jane Doe)'
          },
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
              argv?.proxyURL !== undefined ||
              configFile !== null ||
              argv.skipAuth
                ? null
                : 'toggle',
            name: 'behindProxy',
            message: 'Are you behind a proxy?',
            initial: false,
            active: 'Yes',
            inactive: 'No'
          },
          {
            type: (prev: boolean) => prev && 'text',
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
    } catch (cancelled: unknown) {
      console.log(
        cancelled instanceof Error ? cancelled.message : String(cancelled)
      );
      process.exit(1);
    }

    ({
      author = author,
      title = title,
      description = description,
      proxyURL = proxyURL,
      packageName = packageName,
      overwrite = overwrite
    } = result);

    // Proxy — use saved config if no proxy was provided via prompt or flag
    const savedProxyURL = configFile?.config.proxyURL;
    if (configFile && !argv?.proxyURL && !result.proxyURL) {
      if (savedProxyURL) {
        console.log(`  Using proxy from ${configFile.path}: ${savedProxyURL}`);
      } else {
        console.log(`  No proxy configured in ${configFile.path}`);
      }
    }
    proxyURL = proxyURL ?? savedProxyURL;
    initProxy(proxyURL);

    // Auth — run OAuth flow automatically, no prompts (skipped when --skipAuth)
    if (!argv.skipAuth) {
      if (!configFile && proxyURL) {
        configFile = { config: { proxyURL }, path: getUserLxrJsonPath() };
      }
      const {
        host: oauthHost,
        workspaceName,
        configPath
      } = await runV2Auth(configFile);

      if (oauthHost) {
        host = oauthHost;
        console.log(`✓ Host:      ${host}`);
        console.log(`✓ Workspace: ${workspaceName}`);
      }
      console.log(`  Connection config: ${configPath}`);
    }

    // Scaffold project
    if (targetDir === null) {
      targetDir = packageName ?? defaultProjectName;
    }
    const root = join(cwd, targetDir ?? '');
    console.log(`\nCreating project in ${root}...`);
    console.log(`Using React + TypeScript template`);

    if (overwrite === true) {
      rmSync(root, { recursive: true, force: true });
    }
    if (!existsSync(root)) {
      mkdirSync(root);
    }

    const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent) ?? null;
    const pkgManager = pkgInfo != null ? pkgInfo.name : 'npm';

    deployTemplate({
      defaultProjectName,
      targetDir: root,
      template: TEMPLATE,
      result: { author, title, description, overwrite },
      mcpCustomReportsEnabled: true
    });

    await generateLeanIXFiles({
      targetDir: root,
      result: {
        packageName: packageName ?? defaultProjectName,
        author,
        title,
        description,
        overwrite
      },
      isV2: true
    });

    generateMcpConfig({ targetDir: root });

    // Done
    console.log('\nDone ✅ Now run:\n');
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
    console.log('✓ MCP servers configured (.vscode/mcp.json, .mcp.json)');
    console.log('  Supports: GitHub Copilot (VS Code) and Claude Code');
    console.log('  - Playwright MCP (AI report verification)');
    console.log('  - SAP LeanIX MCP Server (workspace data access)');
    console.log();
    return;
  }

  // -------------------------------------------------------------------------
  // V1 path (unchanged)
  // -------------------------------------------------------------------------

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
          type: () =>
            !existsSync(targetDir ?? '') || overwrite ? null : 'confirm',
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
          type: () => {
            if (packageName !== undefined) return null;
            if (isValidPackageName(targetDir ?? '')) return null;
            return 'text';
          },
          message: 'Package name:',
          initial: () => toValidPackageName(targetDir ?? ''),
          validate: (dir) =>
            isValidPackageName(dir) || 'Invalid package.json name'
        },
        ...getLeanIXQuestions(argv, false)
      ],
      {
        onCancel: () => {
          throw new Error(`${red('✖')} Operation cancelled`);
        }
      }
    );
  } catch (cancelled: unknown) {
    console.log(
      cancelled instanceof Error ? cancelled.message : String(cancelled)
    );
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

  initProxy(proxyURL);
  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent) ?? null;
  const pkgManager = pkgInfo != null ? pkgInfo.name : 'npm';

  let accessToken: string | null = null;
  let mcpCustomReportsEnabled = false;

  if (!argv.skipAuth) {
    // Validate credentials by getting access token, retry if invalid
    while (!accessToken) {
      try {
        if (!host || !apitoken) {
          throw new Error('Host and API token are required');
        }
        accessToken = await exchangeApiToken(host, apitoken);
        console.log('✓ Successfully authenticated with SAP LeanIX');
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
        accessToken,
        featureFlagId: 'mcpserver.custom-reports'
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
            'Set up local MCP servers for AI development?\n  - Playwright MCP (browser-based report verification)\n  - SAP LeanIX MCP Server (workspace data access)\n  ⚠️  Security notice: Technical User Token will be persisted in the MCP server config files\n  Config files are gitignored and take precedence over global settings.',
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

  console.log(`\nCreating project in ${root}...`);
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
    },
    isV2: false
  });

  // Generate MCP configuration files if feature flag enabled and user opted in
  if (setupMcpServers === true && mcpCustomReportsEnabled) {
    generateMcpConfig({ targetDir: root });
  }

  console.log('\nDone ✅ Now run:\n');
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
    console.log(
      'ℹ️  MCP servers not configured - you can set up manually later.'
    );
    console.log(
      '   See https://help.sap.com/docs/leanix/ea/mcp-server for setup instructions.'
    );
    console.log();
  } else if (setupMcpServers === true) {
    console.log('✓ MCP servers configured (.vscode/mcp.json, .mcp.json)');
    console.log('  Supports: GitHub Copilot (VS Code) and Claude Code');
    console.log('  - Playwright MCP (AI report verification)');
    console.log('  - SAP LeanIX MCP Server (workspace data access)');
    console.log();
  }
}

init().catch((e) => {
  console.error(e);
});

export default init;
