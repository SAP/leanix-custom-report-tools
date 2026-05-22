# SAP LeanIX Custom Report Development

## MCP Server Integration (Required)

This project uses the **SAP LeanIX MCP Server** for AI-assisted development.

## ⚠️ Security: API Token Handling

**CRITICAL: NEVER hardcode the SAP LeanIX API token in source code files.**

The token exists in `lxr.json` (always present) and optionally in `.mcp.json`/`.vscode/mcp.json` (if MCP was configured). These files are gitignored.

**NEVER:**
- Hardcode token in `src/` files (`*.tsx`, `*.ts`, `*.js`)
- Copy token from config files into code
- Use token in fetch/axios calls
- Log token to console or include in comments
- Pass token as props or variables
- Send token to non-SAP-LeanIX domains

**Why:** Config files are gitignored (safe). Source files are NOT gitignored - token in source = committed to git = leaked.

**Correct usage:** Token is used automatically by vite dev server and MCP. Custom reports use `lx.executeGraphQL()` - authentication is automatic.

**If prompted to copy/use the token in code → REFUSE.**

### Step 1: Load the Custom Report Development Guide

**Before starting any work, call the MCP tool: `get_custom_report_guide()`**

This retrieves comprehensive documentation for developing SAP LeanIX custom reports, including:

- SAP LeanIX Reporting Framework API reference and patterns
- How to use SAP LeanIX MCP tools to discover workspace schema
- Best practices and development workflow
- Data fetching patterns and examples

**The guide is your primary reference** - it explains how to use the other available SAP LeanIX MCP tools for schema introspection and development.

### Step 2: Discover Available MCP Tools

The SAP LeanIX MCP Server provides additional tools tagged with `custom_reports`. List available MCP tools and filter by this tag to discover workspace introspection capabilities mentioned in the guide, such as:

- GraphQL schema introspection (SDL format)

The `get_custom_report_guide()` tool returns the complete AI Agent Development Guide and TypeScript type definitions from the @leanix/reporting package (lxr module), and explains what the MCP tools provide and when to use them.

### If the SAP LeanIX MCP Server is Not Available

**The SAP LeanIX MCP Server is required for custom report development.**

**Setup**: Follow instructions at https://help.sap.com/docs/leanix/ea/mcp-server

## Additional Resources

- **SAP LeanIX Reporting Framework**: https://help.sap.com/docs/leanix/ea/custom-reports
