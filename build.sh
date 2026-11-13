#!/bin/sh
# Packs the extension folder into dist/siebel-table-extractor-v<version>.zip
set -e
cd "$(dirname "$0")"
v=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/siebel-table-extractor-v$v.zip"
(cd extension && zip -qr "../dist/siebel-table-extractor-v$v.zip" .)
echo "dist/siebel-table-extractor-v$v.zip"
