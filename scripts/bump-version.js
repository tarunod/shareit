#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJsonPath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const isDryRun = process.argv.includes('--dry-run');
const bumpPart = process.env.BUMP_PART || 'patch';

function parseVersion(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

function bump(version, part) {
  const parsed = parseVersion(version);
  if (!parsed) {
    throw new Error(`Unsupported version format "${version}". Expected x.y.z`);
  }
  if (part === 'major') {
    parsed.major += 1;
    parsed.minor = 0;
    parsed.patch = 0;
  } else if (part === 'minor') {
    parsed.minor += 1;
    parsed.patch = 0;
  } else {
    parsed.patch += 1;
  }
  return formatVersion(parsed);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, json) {
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
}

if (!['patch', 'minor', 'major'].includes(bumpPart)) {
  throw new Error(`Invalid BUMP_PART "${bumpPart}". Use patch|minor|major.`);
}

const pkg = readJson(packageJsonPath);
const oldVersion = pkg.version;
const newVersion = bump(oldVersion, bumpPart);

if (isDryRun) {
  console.log(`[dry-run] ${oldVersion} -> ${newVersion}`);
  process.exit(0);
}

pkg.version = newVersion;
writeJson(packageJsonPath, pkg);

if (fs.existsSync(packageLockPath)) {
  const lock = readJson(packageLockPath);
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  writeJson(packageLockPath, lock);
}

console.log(`${oldVersion} -> ${newVersion}`);
