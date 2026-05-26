#!/bin/bash

# Script to run the scaffolding tool and vite plugin locally
# This script builds both packages, runs create-custom-report, and links the local vite plugin

set -e

TOOL_DIR="$(pwd)"

echo "🏗️  Building packages..."
if ! BUILD_OUTPUT=$(npm run build 2>&1); then
    echo "$BUILD_OUTPUT"
    exit 1
fi

# Create global link for vite-plugin
cd packages/vite-plugin
if ! LINK_OUTPUT=$(npm link 2>&1); then
    echo "$LINK_OUTPUT"
    exit 1
fi
cd ../..

# Create global link for leanix-custom-report-cli
cd packages/leanix-custom-report-cli
if ! LINK_OUTPUT=$(npm link --force 2>&1); then
    echo "$LINK_OUTPUT"
    exit 1
fi
cd ../..

LOCAL_CLI_PATH="$TOOL_DIR/packages/leanix-custom-report-cli/dist/cli.js"

echo "📦 Running scaffolding tool..."
echo ""

# Get project name from user
read -p "Enter project name (default: custom-report-test): " PROJECT_NAME
PROJECT_NAME="${PROJECT_NAME:-custom-report-test}"

# Run scaffolding in parent directory
cd ..
if ! node "$TOOL_DIR/packages/create-custom-report/dist/index.cjs" "$PROJECT_NAME" --localCliPath "$LOCAL_CLI_PATH"; then
    exit 1
fi

# Link the local vite plugin to the new project
if [ ! -d "$PROJECT_NAME" ]; then
    echo ""
    echo "⚠️  Project directory '$PROJECT_NAME' not found."
    echo "   Please check if the scaffolding completed successfully."
    exit 1
fi

# Link both local packages into the new project in one command so npm resolves
# them from the global links instead of fetching from the registry
cd "$PROJECT_NAME"
if ! LINK_OUTPUT=$(npm link @sap/vite-plugin-leanix-custom-report @sap/leanix-custom-report-cli 2>&1); then
    echo "$LINK_OUTPUT"
    exit 1
fi

echo ""
echo "✅ Setup complete! Your project is using local @sap/vite-plugin-leanix-custom-report and @sap/leanix-custom-report-cli."
echo ""
echo "📁 Project location: $(pwd)"
echo ""
