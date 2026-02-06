[![REUSE status](https://api.reuse.software/badge/github.com/SAP/leanix-custom-report-tools)](https://api.reuse.software/info/github.com/SAP/leanix-custom-report-tools)

# SAP LeanIX custom report tools

## About this project

SAP LeanIX custom report tools: command line interface to initialize, develop and upload custom reports for LeanIX Enterprise Architecture Management.

- **`@lxr/core`** - Core utilities and types for SAP LeanIX reporting
- **`@sap/create-leanix-custom-report`** - Scaffolding tool to quickly bootstrap new SAP LeanIX custom reports
- **`@sap/vite-plugin-leanix-custom-report`** - Vite plugin for fast development with hot reload and seamless deployment

### Features

- 🚀 Fast development with Vite's hot module replacement
- 📦 Automatic bundling and optimization for LeanIX reports
- 🔧 Built-in TypeScript support
- 📤 One-command deployment to LeanIX workspace
- 🎯 Framework agnostic (works with vanilla JS, React, Vue, etc.) but provides `react` / `react-ts` template out of the box

### Documentation

For detailed documentation on each package see:

- [@sap/vite-plugin-leanix-custom-report](./packages/vite-plugin/README.md) - Vite plugin documentation
- [@sap/create-leanix-custom-report](./packages/create-custom-report/README.md) - Project scaffolding documentation

## Requirements and Setup

- Node.js 24+ and npm/yarn/pnpm
- A SAP LeanIX workspace with API access
- A valid SAP LeanIX API token

You can either use published artifacts (on [npmjs.com](https://www.npmjs.com/)) or build and use the tools manually.

### Building and executing tools manually

Install all depepdencies using `npm install` and

```bash
npm run create-custom-report-local
```

This script will:

1. Build all packages
2. Run the @sap/create-leanix-custom-report scaffolding tool (and create a scaffolded report in `../REPORT_NAME`)
3. Automatically link the local @sap/vite-plugin-leanix-custom-report to your new project

### Using published artifacts

Create a folder/repository and install the tools from [npmjs.com](https://www.npmjs.com/). Use:

```bash
# npm
npm create @sap/leanix-custom-report@latest

# yarn
yarn create @sap/leanix-custom-report

# pnpm
pnpm create @sap/leanix-custom-report
```

to scaffold the report.

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/SAP/leanix-custom-report-tools/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Security / Disclosure

Always ensure to add `lxr.json` to your `.gitignore` to avoid committing sensitive credentials like API tokens.

If you find any bug that may be a security problem, please follow our instructions at [in our security policy](https://github.com/SAP/leanix-custom-report-tools/security/policy) on how to report it. Please do not create GitHub issues for security-related doubts or problems.

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/SAP/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2026 SAP SE or an SAP affiliate company and leanix-custom-report-tools contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/SAP/leanix-custom-report-tools).
