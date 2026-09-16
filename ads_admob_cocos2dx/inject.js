#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ADAPTER = {
  android: {
    groupId: 'io.github.tapmind-tech',
    artifactId: 'customadapter-admob',
    defaultVersion: '3.0.4',
    minSdkVersion: 23,
  },
  ios: {
    // Intentionally unversioned: the pod is injected as `pod 'TapMindSDK'` and
    // CocoaPods resolves it, so --adapter-version does not apply to iOS.
    podName: 'TapMindAdapter',
  },
};

const LABEL = 'TapMind AdMob adapter';

function printUsage() {
  console.log(`
ads_admob_cocos2dx — TapMind AdMob adapter installer

Usage:
  node inject.js --project <game-root> [--platform android|ios|all] [--adapter-version <version>]

Flags:
  --project          Required. Path to the Cocos2d-x 4.0 game root (contains proj.android / proj.ios_mac).
  --platform         Optional. android, ios, or all. Default: all.
  --adapter-version  Optional. Android only — overrides the adapter version to inject.
                     Default: ${ADAPTER.android.defaultVersion}.
                     iOS is always injected unversioned as: pod '${ADAPTER.ios.podName}'
  --help             Show this message.

This tool only wires the ${LABEL} dependency into your native Android/iOS
project files. It does not add the Google Mobile Ads SDK, an AdMob App ID,
or any Load/Show ad code — you add those separately.
`);
}

function parseArgs(argv) {
  const args = { platform: 'all', adapterVersion: null, project: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--project':
        args.project = argv[++i];
        break;
      case '--platform':
        args.platform = argv[++i];
        break;
      case '--adapter-version':
        args.adapterVersion = argv[++i];
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function fail(message) {
  console.error(`[ads_admob_cocos2dx] ERROR: ${message}`);
  process.exitCode = 1;
}

function log(message) {
  console.log(`[ads_admob_cocos2dx] ${message}`);
}

function warn(message) {
  console.warn(`[ads_admob_cocos2dx] WARNING: ${message}`);
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function markers(commentChar, label) {
  return {
    begin: `${commentChar} >>> ads_admob_cocos2dx: ${label} (managed — do not edit between these markers) >>>`,
    end: `${commentChar} <<< ads_admob_cocos2dx: ${label} <<<`,
  };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds an existing marked block, if any. Returns { found, start, end, text } where
 * start/end are character offsets of the whole block (including markers and trailing newline).
 */
function findMarkedBlock(content, commentChar, label) {
  const { begin, end } = markers(commentChar, label);
  const re = new RegExp(`[ \\t]*${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*\\r?\\n?`);
  const match = content.match(re);
  if (!match) return { found: false };
  return { found: true, start: match.index, end: match.index + match[0].length, text: match[0] };
}

function buildBlock(commentChar, label, indent, bodyLines) {
  const { begin, end } = markers(commentChar, label);
  const lines = [indent + begin, ...bodyLines.map((l) => indent + l), indent + end];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

function ensureMavenCentral(topBuildGradlePath) {
  if (!fs.existsSync(topBuildGradlePath)) {
    warn(`${path.relative(process.cwd(), topBuildGradlePath)} not found — skipping mavenCentral() check.`);
    return;
  }
  let content = readFile(topBuildGradlePath);
  const allprojectsRe = /allprojects\s*\{([^]*?)\n\}/;
  const match = content.match(allprojectsRe);
  if (!match) {
    warn(
      `Could not find an "allprojects { repositories { ... } }" block in ${path.relative(
        process.cwd(),
        topBuildGradlePath
      )}. If this project resolves repositories from settings.gradle ` +
        `(dependencyResolutionManagement), add mavenCentral() there manually.`
    );
    return;
  }
  const block = match[1];
  const repositoriesRe = /repositories\s*\{([^]*?)\n(\s*)\}/;
  const repoMatch = block.match(repositoriesRe);
  if (!repoMatch) {
    warn(`Could not find a "repositories { ... }" block inside "allprojects" in ${topBuildGradlePath}.`);
    return;
  }
  if (/mavenCentral\s*\(\s*\)/.test(repoMatch[1])) {
    log('mavenCentral() already present in proj.android/build.gradle.');
    return;
  }
  const indent = repoMatch[2] + '    ';
  const newRepoBlock = repoMatch[0].replace(
    repositoriesRe,
    (whole, inner, closingIndent) => `repositories {${inner}\n${indent}mavenCentral()\n${closingIndent}}`
  );
  const newBlock = block.replace(repositoriesRe, newRepoBlock);
  content = content.replace(allprojectsRe, `allprojects {${newBlock}\n}`);
  writeFile(topBuildGradlePath, content);
  log('Added mavenCentral() to proj.android/build.gradle.');
}

function injectAndroidDependency(appBuildGradlePath, version) {
  if (!fs.existsSync(appBuildGradlePath)) {
    throw new Error(`${path.relative(process.cwd(), appBuildGradlePath)} not found.`);
  }
  let content = readFile(appBuildGradlePath);
  const depLine = `implementation '${ADAPTER.android.groupId}:${ADAPTER.android.artifactId}:${version}'`;
  const existing = findMarkedBlock(content, '//', 'adapter dependency');

  if (existing.found) {
    if (existing.text.includes(depLine)) {
      log(`Android adapter dependency already present at version ${version} — skipping.`);
      return;
    }
    const newBlock = buildBlock('//', 'adapter dependency', '    ', [depLine]);
    content = content.slice(0, existing.start) + newBlock + content.slice(existing.end);
    writeFile(appBuildGradlePath, content);
    log(`Updated Android adapter dependency to version ${version}.`);
    return;
  }

  const dependenciesRe = /dependencies\s*\{/;
  if (!dependenciesRe.test(content)) {
    throw new Error(`Could not find a "dependencies { ... }" block in ${appBuildGradlePath}.`);
  }
  const newBlock = buildBlock('//', 'adapter dependency', '    ', [depLine]);
  content = content.replace(dependenciesRe, (match) => `${match}\n${newBlock}`);
  writeFile(appBuildGradlePath, content);
  log(`Added Android adapter dependency (version ${version}) to proj.android/app/build.gradle.`);
}

function checkMinSdkVersion(androidDir) {
  const gradlePropertiesPath = path.join(androidDir, 'gradle.properties');
  if (!fs.existsSync(gradlePropertiesPath)) {
    warn(`${path.relative(process.cwd(), gradlePropertiesPath)} not found — skipping minSdkVersion check.`);
    return;
  }
  const content = readFile(gradlePropertiesPath);
  const match = content.match(/^PROP_MIN_SDK_VERSION\s*=\s*(\d+)/m);
  if (!match) {
    warn(`Could not find PROP_MIN_SDK_VERSION in ${gradlePropertiesPath} — skipping minSdkVersion check.`);
    return;
  }
  const minSdkVersion = parseInt(match[1], 10);
  if (minSdkVersion < ADAPTER.android.minSdkVersion) {
    throw new Error(
      `PROP_MIN_SDK_VERSION is ${minSdkVersion} in ${path.relative(process.cwd(), gradlePropertiesPath)}, ` +
        `but ${LABEL} requires minSdkVersion ${ADAPTER.android.minSdkVersion}. ` +
        `Raise PROP_MIN_SDK_VERSION to at least ${ADAPTER.android.minSdkVersion} before building, ` +
        `or the manifest merger will fail.`
    );
  }
}

function injectAndroid(projectRoot, version) {
  const androidDir = path.join(projectRoot, 'proj.android');
  if (!fs.existsSync(androidDir)) {
    throw new Error(
      `proj.android not found under ${projectRoot}. Pass the correct --project path, or omit --platform android/all if this project has no Android target.`
    );
  }
  checkMinSdkVersion(androidDir);
  ensureMavenCentral(path.join(androidDir, 'build.gradle'));
  injectAndroidDependency(path.join(androidDir, 'app', 'build.gradle'), version);
}

// ---------------------------------------------------------------------------
// iOS
// ---------------------------------------------------------------------------

function detectAppName(projectRoot) {
  const cmakeListsPath = path.join(projectRoot, 'CMakeLists.txt');
  if (fs.existsSync(cmakeListsPath)) {
    const content = readFile(cmakeListsPath);
    const match = content.match(/set\s*\(\s*APP_NAME\s+([^\s)]+)\s*\)/);
    if (match) return match[1];
  }
  return path.basename(projectRoot);
}

function findEnclosingTargetBlocks(content) {
  const targetRe = /target\s+(['"])([^'"]+)\1\s+do\b/g;
  const blocks = [];
  let match;
  while ((match = targetRe.exec(content)) !== null) {
    const bodyStart = match.index + match[0].length;
    const endIndex = findMatchingEnd(content, bodyStart);
    if (endIndex !== -1) {
      blocks.push({ name: match[2], bodyStart, insertBefore: endIndex });
    }
  }
  return blocks;
}

// Finds the "end" that closes the "do" block starting right after `fromIndex`,
// accounting for nested do...end blocks (e.g. target_extension, if/end).
function findMatchingEnd(content, fromIndex) {
  const blockOpenRe = /\b(do)\b|\bend\b/g;
  blockOpenRe.lastIndex = fromIndex;
  let depth = 1;
  let match;
  while ((match = blockOpenRe.exec(content)) !== null) {
    if (match[0] === 'do') depth++;
    else depth--;
    if (depth === 0) return match.index;
  }
  return -1;
}

function injectIOS(projectRoot) {
  const iosDir = path.join(projectRoot, 'proj.ios_mac');
  if (!fs.existsSync(iosDir)) {
    throw new Error(
      `proj.ios_mac not found under ${projectRoot}. Pass the correct --project path, or omit --platform ios/all if this project has no iOS target.`
    );
  }
  const podfilePath = path.join(iosDir, 'Podfile');
  const podLine = `pod '${ADAPTER.ios.podName}'`;

  if (!fs.existsSync(podfilePath)) {
    const appName = detectAppName(projectRoot);
    const block = buildBlock('#', 'adapter pod', '  ', [podLine]);
    const content = `platform :ios, '12.0'\n\ntarget '${appName}' do\n${block}end\n`;
    writeFile(podfilePath, content);
    log(`No Podfile found — created proj.ios_mac/Podfile with target '${appName}' (iOS 12.0).`);
    warn(
      `Verify the target name matches your Xcode project once it is generated (run CMake / open the project) — edit proj.ios_mac/Podfile if it does not.`
    );
    log('Run `pod install` inside proj.ios_mac before building.');
    return;
  }

  let content = readFile(podfilePath);
  const existing = findMarkedBlock(content, '#', 'adapter pod');

  if (existing.found) {
    // Exact match, not substring: `pod 'TapMindSDK', '~> 3.0.3'` *contains*
    // `pod 'TapMindSDK'`, so a substring test would leave blocks written by
    // older versions of this installer stuck on their version constraint.
    const existingBody = existing.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    if (existingBody.length === 1 && existingBody[0] === podLine) {
      log('iOS adapter pod already present — skipping.');
      log('Run `pod install` inside proj.ios_mac before building.');
      return;
    }
    const block = buildBlock('#', 'adapter pod', '  ', [podLine]);
    content = content.slice(0, existing.start) + block + content.slice(existing.end);
    writeFile(podfilePath, content);
    log('Rewrote the iOS adapter pod block.');
    log('Run `pod install` inside proj.ios_mac before building.');
    return;
  }

  const targets = findEnclosingTargetBlocks(content);
  const block = buildBlock('#', 'adapter pod', '  ', [podLine]);

  if (targets.length === 0) {
    content = content.replace(/\s*$/, '\n') + block;
    writeFile(podfilePath, content);
    log('Added adapter pod at the end of proj.ios_mac/Podfile (no target block found).');
  } else {
    if (targets.length > 1) {
      warn(
        `Podfile has ${targets.length} targets (${targets
          .map((t) => `'${t.name}'`)
          .join(', ')}). The adapter pod was only added to '${targets[0].name}'. ` +
          `Copy the marked block into the other targets if they also need the adapter.`
      );
    }
    const target = targets[0];
    content = content.slice(0, target.insertBefore) + block + content.slice(target.insertBefore);
    writeFile(podfilePath, content);
    log(`Added adapter pod to target '${target.name}' in proj.ios_mac/Podfile.`);
  }
  log('Run `pod install` inside proj.ios_mac before building.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err.message);
    printUsage();
    process.exit(1);
  }

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.project) {
    fail('--project <game-root> is required.');
    printUsage();
    process.exit(1);
  }

  const validPlatforms = ['android', 'ios', 'all'];
  if (!validPlatforms.includes(args.platform)) {
    fail(`--platform must be one of: ${validPlatforms.join(', ')} (got "${args.platform}").`);
    process.exit(1);
  }

  const projectRoot = path.resolve(args.project);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    fail(`--project path does not exist or is not a directory: ${projectRoot}`);
    process.exit(1);
  }

  const platforms = args.platform === 'all' ? ['android', 'ios'] : [args.platform];

  if (args.adapterVersion && platforms.includes('ios')) {
    warn('--adapter-version applies to Android only — the iOS pod is injected unversioned.');
  }

  let hadError = false;
  for (const platform of platforms) {
    try {
      if (platform === 'android') {
        injectAndroid(projectRoot, args.adapterVersion || ADAPTER.android.defaultVersion);
      } else {
        injectIOS(projectRoot);
      }
    } catch (err) {
      fail(err.message);
      hadError = true;
    }
  }

  if (hadError) {
    process.exit(1);
  }
  log('Done.');
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, injectAndroid, injectIOS, detectAppName };
