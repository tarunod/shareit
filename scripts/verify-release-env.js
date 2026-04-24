#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJsonPath = path.join(root, 'package.json');

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const publishConfig = pkg?.build?.publish || {};
const owner = publishConfig.owner;
const repo = publishConfig.repo;

if (!owner || !repo) {
  console.error('Release config missing: build.publish.owner/repo in package.json');
  process.exit(1);
}

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  console.error('Missing GitHub token. Set GH_TOKEN (or GITHUB_TOKEN) before npm run dist.');
  process.exit(1);
}

console.log(`Release environment looks good for ${owner}/${repo}`);
