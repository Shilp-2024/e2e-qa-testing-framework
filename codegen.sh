#!/bin/bash

# Playwright Codegen Runner
# Usage:   ./codegen.sh {FeatureName} [browser]
# Example: ./codegen.sh UserLogin chromium
#          ./codegen.sh PatientManagement firefox

FEATURE=${1}
BROWSER=${2:-chromium}

# Load BASE_URL from .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep BASE_URL | xargs)
fi

if [ -z "$BASE_URL" ]; then
  echo "ERROR: BASE_URL is not set."
  echo "Add BASE_URL=https://your-app.com to your .env file."
  exit 1
fi

if [ -z "$FEATURE" ]; then
  echo "Usage: ./codegen.sh {FeatureName} [browser]"
  echo "Example: ./codegen.sh UserLogin chromium"
  exit 1
fi

# Output path for the captured script
OUTPUT_DIR="features/${FEATURE}/locators"
OUTPUT_FILE="${OUTPUT_DIR}/extract_${FEATURE}_codegen.js"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "Starting Playwright Codegen"
echo "  Feature : $FEATURE"
echo "  Browser : $BROWSER"
echo "  URL     : $BASE_URL"
echo "  Output  : $OUTPUT_FILE"
echo ""
echo "Instructions:"
echo "  1. If login is required, complete it first in the browser"
echo "  2. Navigate to the $FEATURE page"
echo "  3. Interact with every UI element listed in features/$FEATURE/spec/QA_$FEATURE.md"
echo "  4. For error states (validation messages), trigger the error then click the element"
echo "  5. Close the browser when done — the script saves automatically"
echo ""

npx playwright codegen --browser="$BROWSER" --output="$OUTPUT_FILE" "$BASE_URL"

echo ""
echo "Codegen session complete."
echo "  Captured script : $OUTPUT_FILE"
echo ""
echo "Next step — trigger Agent 2 in Claude Code:"
echo "  'Run Agent 2 for $FEATURE'"
