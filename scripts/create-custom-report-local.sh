#!/bin/bash

# Script to run the creation tool and vite plugin locally
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

echo "📦 Running creation tool..."
echo ""

# Run creation tool in parent directory (v2 flow)
cd ..
# Snapshot directories before and after to detect the newly created project folder
BEFORE=$(ls -d */ 2>/dev/null)
if ! node "$TOOL_DIR/packages/create-custom-report/dist/index.cjs" --v2 "$@"; then
    exit 1
fi
AFTER=$(ls -d */ 2>/dev/null)
PROJECT_NAME=$(comm -13 <(echo "$BEFORE" | sort) <(echo "$AFTER" | sort) | tr -d '/')

# Link the local vite plugin to the new project
if [ ! -d "$PROJECT_NAME" ]; then
    echo ""
    echo "⚠️  Project directory '$PROJECT_NAME' not found."
    echo "   Please check if the creation completed successfully."
    exit 1
fi

# Create a symbolic link from globally-installed vite-plugin to node_modules/
cd "$PROJECT_NAME"
if ! LINK_OUTPUT=$(npm link @sap/vite-plugin-leanix-custom-report 2>&1); then
    echo "$LINK_OUTPUT"
    exit 1
fi

echo ""
echo "✅ Setup complete! Your project is using local @sap/vite-plugin-leanix-custom-report."
echo ""
echo "📁 Project location: $(pwd)"
echo ""
