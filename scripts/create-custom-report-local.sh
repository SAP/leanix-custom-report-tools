#!/bin/bash

# Script to run the creation tool and vite plugin locally
# This script builds both packages, runs create-custom-report, and links the local vite plugin

set -eo pipefail

TOOL_DIR="$(pwd)"

echo "Building packages..."
if ! BUILD_OUTPUT=$(npm run build 2>&1); then
    echo "$BUILD_OUTPUT"
    exit 1
fi

# Create global link for vite-plugin and create-custom-report
cd packages/vite-plugin
if ! LINK_OUTPUT=$(npm link 2>&1); then
    echo "$LINK_OUTPUT"
    exit 1
fi
cd ../..

cd packages/create-custom-report
if ! LINK_OUTPUT=$(npm link 2>&1); then
    echo "$LINK_OUTPUT"
    exit 1
fi
cd ../..

echo "Running creation tool..."

# Run creation tool in parent directory via npm exec to mimic npm create
cd ..
TMPOUT=$(mktemp)
EXIT_CODE=0
echo "-----------------------------------------------------------------"
npm exec --yes -- create-leanix-custom-report "$@" | tee "$TMPOUT" || EXIT_CODE=$?
echo "-----------------------------------------------------------------"
PROJECT_DIR=$(grep "^Creating project in" "$TMPOUT" | sed 's/^Creating project in //' || true)
rm "$TMPOUT"

if [ "$EXIT_CODE" -ne 0 ] || [ -z "$PROJECT_DIR" ]; then
    echo "Error: project creation failed."
    exit 1
fi

PROJECT_NAME=$(basename "$PROJECT_DIR")

echo "Linking local vite plugin to project..."
cd "$PROJECT_NAME"
if ! LINK_OUTPUT=$(npm link @sap/vite-plugin-leanix-custom-report 2>&1); then
    echo "$LINK_OUTPUT"
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo "   Using the vite plugin from: $TOOL_DIR/packages/vite-plugin"
echo "   npm install would revert to using the published version of the plugin."
echo "   Project location: $(pwd)"
echo ""
