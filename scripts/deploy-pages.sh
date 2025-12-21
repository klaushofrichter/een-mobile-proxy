#!/bin/bash

# Deploy admin and demo1 apps to GitHub Pages
# This script builds both Vue apps and deploys them to the gh-pages branch

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "GitHub Pages Deployment"
echo "========================================"

# Check if gh-pages is installed
if ! npx gh-pages --version > /dev/null 2>&1; then
    echo "Installing gh-pages..."
    npm install -g gh-pages
fi

# Create temporary dist directory
DIST_DIR="$PROJECT_ROOT/dist"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Build admin app
echo ""
echo "Building admin app..."
cd "$PROJECT_ROOT/admin"
npm install
npm run build
cp -r dist "$DIST_DIR/admin"

# Build demo1 app
echo ""
echo "Building demo1 app..."
cd "$PROJECT_ROOT/demo1"
npm install
npm run build
cp -r dist "$DIST_DIR/demo1"

# Create index.html redirect at root
cat > "$DIST_DIR/index.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EEN OAuth Proxy</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 600px;
            margin: 100px auto;
            padding: 20px;
            text-align: center;
        }
        h1 { color: #333; }
        a {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: #2563eb;
            color: white;
            text-decoration: none;
            border-radius: 6px;
        }
        a:hover { background: #1d4ed8; }
    </style>
</head>
<body>
    <h1>EEN OAuth Proxy</h1>
    <p>Select an application:</p>
    <a href="./demo1/">Demo App</a>
    <a href="./admin/">Admin App</a>
</body>
</html>
EOF

# Create .nojekyll to prevent Jekyll processing
touch "$DIST_DIR/.nojekyll"

# Deploy to gh-pages
echo ""
echo "Deploying to GitHub Pages..."
cd "$PROJECT_ROOT"
npx gh-pages -d dist --dotfiles

echo ""
echo "========================================"
echo "Deployment complete!"
echo "========================================"
echo ""
echo "Your apps are available at:"
echo "  - Demo: https://your-username.github.io/een-oauth-proxy/demo1/"
echo "  - Admin: https://your-username.github.io/een-oauth-proxy/admin/"
echo ""

# Cleanup
rm -rf "$DIST_DIR"
