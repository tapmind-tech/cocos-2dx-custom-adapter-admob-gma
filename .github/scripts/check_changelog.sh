#!/usr/bin/env bash
# Ensures CHANGELOG.md documents the version in ads_admob_cocos2dx/package.json.
set -euo pipefail

node <<'NODE'
const fs = require('fs');
const path = require('path');

const packagePath = path.join('ads_admob_cocos2dx', 'package.json');
if (!fs.existsSync(packagePath)) {
  console.error(`ERROR: ${packagePath} is missing.`);
  process.exit(1);
}

const { version } = require(path.resolve(packagePath));
const changelogPath = 'CHANGELOG.md';

if (!fs.existsSync(changelogPath)) {
  console.error('ERROR: CHANGELOG.md is missing.');
  console.error('Create CHANGELOG.md and add a section for the current version.');
  process.exit(1);
}

const changelog = fs.readFileSync(changelogPath, 'utf8');
const escaped = version.replace(/\./g, '\\.');

const headingPatterns = [
  new RegExp(`^## \\[${escaped}\\]`, 'm'),
  new RegExp(`^## ${escaped}(?:\\s|$)`, 'm'),
];

if (!headingPatterns.some((pattern) => pattern.test(changelog))) {
  console.error(`ERROR: CHANGELOG.md must include a section for version ${version}.`);
  console.error('');
  console.error('Add a section like:');
  console.error(`## [${version}] - YYYY-MM-DD`);
  console.error('');
  console.error('### Added');
  console.error('- Describe your change');
  process.exit(1);
}

const sectionPattern = new RegExp(
  `^## (?:\\[${escaped}\\]|${escaped})(?:[^\\n]*)\\n([\\s\\S]*?)(?=^## )`,
  'm',
);
let match = changelog.match(sectionPattern);
if (!match) {
  const lastSectionPattern = new RegExp(
    `^## (?:\\[${escaped}\\]|${escaped})(?:[^\\n]*)\\n([\\s\\S]*)$`,
    'm',
  );
  match = changelog.match(lastSectionPattern);
}

if (!match || !match[1].trim()) {
  console.error(`ERROR: CHANGELOG section for ${version} is empty.`);
  process.exit(1);
}

const body = match[1];
if (!/^[\t ]*[-*]\s+\S/m.test(body)) {
  console.error(
    `ERROR: CHANGELOG section for ${version} must include at least one bullet point (- item).`,
  );
  process.exit(1);
}

console.log(`CHANGELOG OK — version ${version} is documented.`);
NODE
