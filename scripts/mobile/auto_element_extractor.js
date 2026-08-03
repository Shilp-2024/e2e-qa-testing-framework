#!/usr/bin/env node
/**
 * auto_element_extractor.js
 *
 * Single-session Appium element extractor for Agent 2 (mobile). One Appium session per
 * screen does what the web extractor does for a page, using the accessibility tree instead
 * of the DOM:
 *   1. Interactive elements (buttons, fields, switches, pickers) via a per-class element scan
 *   2. Structural elements (static text/headers, nav bars, alerts) — folded in
 *   3. Dynamic elements revealed by declarative interactions (open a picker / submit invalid
 *      form), driven by an optional interactions.json — same schema/replay concept as web
 *   4. Uniqueness validation — every selector gets a `matchCount` in the SAME session
 *
 * Because mobile screens have no URL to `goto()`, reaching the target screen is itself a
 * declarative step: interactions.json entries carry an optional `navigateSteps` array that
 * runs right after app launch (and after an optional --login flow's own navigateSteps) to
 * arrive at the screen before capture begins.
 *
 * Output is the FINAL, merge-preserving `{Feature}_locators.json` (existing acRefs / findings /
 * status overrides, and the OTHER platform's data, are never clobbered on re-run) plus a raw
 * `extract_{Feature}_mobile_auto.json` audit snapshot. A page-source-hash cache skips
 * re-extraction of unchanged screens (override with --force).
 *
 * Usage:
 *   node scripts/mobile/auto_element_extractor.js --feature Login --screen loginScreen --platform android
 *   node scripts/mobile/auto_element_extractor.js --feature Login --screen homeScreen --platform ios --login loginFlow --force
 *
 * Options:
 *   --feature     PascalCase feature name (matches features/mobile/ folder name)
 *   --screen      camelCase screen key used as the JSON section key (e.g. homeScreen)
 *   --platform    android | ios
 *   --app         Optional: path to a local .apk/.app/.ipa (overrides env build-artifact vars)
 *   --appPackage / --appActivity   Optional: target an already-installed Android app
 *   --bundleId    Optional: target an already-installed iOS app
 *   --udid        Optional: device/simulator UDID (overrides env)
 *   --login       Optional: name of an interactions.json entry whose navigateSteps log in,
 *                 replayed before this screen's own navigateSteps
 *   --interactions  Optional: path to interactions.json (default features/mobile/{Feature}/locators/interactions.json)
 *   --force       Ignore the page-source-hash cache and re-extract
 *
 * Environment variables (from .env):
 *   APPIUM_SERVER_URL, ANDROID_APK_PATH, ANDROID_APP_PACKAGE, ANDROID_APP_ACTIVITY,
 *   ANDROID_DEVICE_NAME, ANDROID_PLATFORM_VERSION, IOS_APP_PATH, IOS_IPA_PATH, IOS_BUNDLE_ID,
 *   IOS_DEVICE_NAME, IOS_PLATFORM_VERSION, IOS_UDID, ACTION_TIMEOUT
 *
 * interactions.json schema (values are project-specific, schema is generic):
 *   {
 *     "loginFlow": {
 *       "navigateSteps": [
 *         { "action": "setValue", "target": "~usernameField", "value": "qa_user" },
 *         { "action": "setValue", "target": "~passwordField", "value": "..." },
 *         { "action": "tap", "target": "~loginButton" }
 *       ]
 *     },
 *     "homeScreen": {
 *       "navigateSteps": [ { "action": "tap", "target": "~homeTab" } ],
 *       "steps": [
 *         { "action": "tap", "target": "~openFiltersButton", "captureAfter": true, "note": "open filters sheet" }
 *       ]
 *     }
 *   }
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config();

const ACTION_TIMEOUT = Number(process.env.ACTION_TIMEOUT) || 90000;

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const feature = get('--feature');
  const screen = get('--screen');
  const platform = get('--platform');

  if (!feature || !screen || !platform || !['android', 'ios'].includes(platform)) {
    console.error(
      '\nUsage:\n' +
        '  node scripts/mobile/auto_element_extractor.js \\\n' +
        '    --feature <PascalCaseName> \\\n' +
        '    --screen  <camelCaseScreenName> \\\n' +
        '    --platform <android|ios> \\\n' +
        '    [--app <path>] [--appPackage <pkg> --appActivity <activity>] [--bundleId <id>] \\\n' +
        '    [--udid <udid>] [--login <interactionsKey>] [--interactions <path>] [--force]\n'
    );
    process.exit(1);
  }

  return {
    feature,
    screen,
    platform,
    app: get('--app'),
    appPackage: get('--appPackage'),
    appActivity: get('--appActivity'),
    bundleId: get('--bundleId'),
    udid: get('--udid'),
    login: get('--login'),
    interactions: get('--interactions'),
    force: args.includes('--force'),
  };
}

// ─── Capability building (simulator vs real device branches on iOS) ──────────

function buildCapabilities(platform, args) {
  if (platform === 'android') {
    const apkPath = args.app || process.env.ANDROID_APK_PATH;
    const caps = {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': process.env.ANDROID_DEVICE_NAME || 'Android Emulator',
      'appium:newCommandTimeout': 120,
      // Default (20s) can be too short for a cold app-process start on a loaded dev machine —
      // observed 'am start-activity -W ... timed out after 20000ms' failures otherwise.
      'appium:adbExecTimeout': 60000,
    };
    if (process.env.ANDROID_PLATFORM_VERSION) caps['appium:platformVersion'] = process.env.ANDROID_PLATFORM_VERSION;
    if (args.udid) caps['appium:udid'] = args.udid;

    const appPackage = args.appPackage || process.env.ANDROID_APP_PACKAGE;
    const appActivity = args.appActivity || process.env.ANDROID_APP_ACTIVITY;
    if (apkPath && fs.existsSync(apkPath)) {
      caps['appium:app'] = path.resolve(apkPath);
    } else if (appPackage && appActivity) {
      caps['appium:appPackage'] = appPackage;
      caps['appium:appActivity'] = appActivity;
    } else {
      throw new Error(
        'Android target not specified: set --app/ANDROID_APK_PATH, or --appPackage+--appActivity/ANDROID_APP_PACKAGE+ANDROID_APP_ACTIVITY.'
      );
    }
    return caps;
  }

  // iOS — .app bundles are simulator-only, signed .ipa is real-device-only (not interchangeable).
  const ipaPath = process.env.IOS_IPA_PATH;
  const appPath = args.app || process.env.IOS_APP_PATH;
  const udid = args.udid || process.env.IOS_UDID;
  const isRealDevice = !!udid && !!ipaPath;

  const caps = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': process.env.IOS_DEVICE_NAME || 'iPhone Simulator',
    'appium:newCommandTimeout': 120,
  };
  if (process.env.IOS_PLATFORM_VERSION) caps['appium:platformVersion'] = process.env.IOS_PLATFORM_VERSION;
  if (udid) caps['appium:udid'] = udid;

  const bundleId = args.bundleId || process.env.IOS_BUNDLE_ID;
  if (isRealDevice) {
    caps['appium:app'] = path.resolve(ipaPath);
  } else if (appPath && fs.existsSync(appPath)) {
    caps['appium:app'] = path.resolve(appPath);
  } else if (bundleId) {
    caps['appium:bundleId'] = bundleId;
  } else {
    throw new Error(
      'iOS target not specified: set --app/IOS_APP_PATH (.app, simulator) or IOS_IPA_PATH+udid (real device), or --bundleId/IOS_BUNDLE_ID for an already-installed app.'
    );
  }
  return caps;
}

// ─── Element name / role / locator expression generation ─────────────────────

const ROLE_SUFFIX = {
  button: 'Button',
  textbox: 'Input',
  checkbox: 'Checkbox',
  radio: 'Radio',
  switch: 'Toggle',
  combobox: 'Dropdown',
  text: 'Text',
  nav: 'Nav',
  alert: 'Alert',
  image: 'Image',
};

const ROLE_TYPE_LABEL = {
  button: 'Button',
  textbox: 'TextInput',
  checkbox: 'Checkbox',
  radio: 'RadioButton',
  switch: 'Toggle',
  combobox: 'Dropdown',
  text: 'StaticText',
  nav: 'Nav',
  alert: 'Alert',
  image: 'Image',
};

// className -> { role, interactive } — the per-platform element-class scan list.
const ANDROID_CLASS_MAP = {
  'android.widget.Button': { role: 'button', interactive: true },
  'android.widget.ImageButton': { role: 'button', interactive: true },
  'android.widget.EditText': { role: 'textbox', interactive: true },
  'android.widget.CheckBox': { role: 'checkbox', interactive: true },
  'android.widget.RadioButton': { role: 'radio', interactive: true },
  'android.widget.Switch': { role: 'switch', interactive: true },
  'android.widget.Spinner': { role: 'combobox', interactive: true },
  'android.widget.Toolbar': { role: 'nav', interactive: false },
  'android.app.AlertDialog': { role: 'alert', interactive: false },
  'android.widget.ImageView': { role: 'image', interactive: false },
  'android.widget.TextView': { role: 'text', interactive: false },
  // React Native apps often render labels/validation text as plain Views with an
  // accessibilityLabel rather than a native TextView (confirmed: an email-format
  // validation message and a field label were both invisible to the scanner until this was
  // added). Safe to include broadly — the name-or-interactive filter in scanClass() already
  // drops unnamed Views, so this doesn't flood results with unlabeled layout containers.
  'android.view.View': { role: 'text', interactive: false },
};

const IOS_CLASS_MAP = {
  XCUIElementTypeButton: { role: 'button', interactive: true },
  XCUIElementTypeTextField: { role: 'textbox', interactive: true },
  XCUIElementTypeSecureTextField: { role: 'textbox', interactive: true },
  XCUIElementTypeSwitch: { role: 'switch', interactive: true },
  XCUIElementTypePickerWheel: { role: 'combobox', interactive: true },
  XCUIElementTypeNavigationBar: { role: 'nav', interactive: false },
  XCUIElementTypeAlert: { role: 'alert', interactive: false },
  XCUIElementTypeImage: { role: 'image', interactive: false },
  XCUIElementTypeStaticText: { role: 'text', interactive: false },
};

function toElementName(role, name) {
  const clean = (name || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');

  const base = clean || role;
  const suffix = ROLE_SUFFIX[role] || role[0].toUpperCase() + role.slice(1);
  return base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : base + suffix;
}

/** Build the cross-platform accessibility-id candidate and the platform-specific fallback. */
function toLocatorExpressions(platform, role, node) {
  const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
  const accessibleId = node.accessibleId; // content-desc (Android) or name (iOS)

  const crossPlatformPrimary = accessibleId ? `~${accessibleId}` : undefined;

  let fallback;
  if (platform === 'android') {
    if (node.resourceId) fallback = `android=new UiSelector().resourceId("${esc(node.resourceId)}")`;
    else if (node.text) fallback = `android=new UiSelector().text("${esc(node.text)}")`;
    else fallback = `android=new UiSelector().className("${node.className}")`;
  } else {
    if (node.name) fallback = `-ios predicate string:name == '${esc(node.name)}'`;
    else if (node.value) fallback = `-ios predicate string:value == '${esc(node.value)}'`;
    else fallback = `-ios predicate string:type == '${node.className}'`;
  }

  return { primary: crossPlatformPrimary || fallback, fallback };
}

// ─── Appium-side collectors (live session queries, not raw XML parsing) ──────

async function scanClass(driver, platform, className, roleInfo) {
  const selector =
    platform === 'android'
      ? `android=new UiSelector().className("${className}")`
      : `-ios predicate string:type == '${className}'`;

  const elements = await driver.$$(selector);
  const nodes = [];
  for (const el of elements) {
    try {
      const isDisplayed = await el.isDisplayed().catch(() => true);
      if (!isDisplayed) continue;

      if (platform === 'android') {
        const contentDesc = await el.getAttribute('content-desc').catch(() => '');
        const text = await el.getAttribute('text').catch(() => '');
        const resourceId = await el.getAttribute('resource-id').catch(() => '');
        const clickable = await el.getAttribute('clickable').catch(() => 'false');
        nodes.push({
          role: roleInfo.role,
          interactive: roleInfo.interactive || clickable === 'true',
          className,
          accessibleId: contentDesc || undefined,
          text: text || undefined,
          resourceId: resourceId ? resourceId.split('/').pop() : undefined,
          name: contentDesc || text || (resourceId ? resourceId.split('/').pop() : ''),
        });
      } else {
        const name = await el.getAttribute('name').catch(() => '');
        const label = await el.getAttribute('label').catch(() => '');
        const value = await el.getAttribute('value').catch(() => '');
        nodes.push({
          role: roleInfo.role,
          interactive: roleInfo.interactive,
          className,
          accessibleId: name || undefined,
          value: value || undefined,
          name: name || label || value || '',
        });
      }
    } catch {
      // Stale element (screen changed mid-scan) — skip it, next scan will pick it up.
    }
  }
  // Interactive elements (form fields, buttons) are kept even with an empty name — some inputs
  // carry their accessible label on a wrapping/sibling element rather than the leaf node itself
  // (confirmed on a React Native email field with content-desc/text/resource-id all empty until
  // typed into). toElementName() falls back to a role-based name (e.g. "textboxInput") for these.
  // Purely structural/decorative nodes with no name are still dropped to avoid noise.
  return nodes.filter((n) => n.name || n.interactive);
}

async function scanScreen(driver, platform) {
  const classMap = platform === 'android' ? ANDROID_CLASS_MAP : IOS_CLASS_MAP;
  const interactive = [];
  const structural = [];
  for (const [className, roleInfo] of Object.entries(classMap)) {
    const nodes = await scanClass(driver, platform, className, roleInfo);
    for (const node of nodes) (node.interactive ? interactive : structural).push(node);
  }
  return { interactive, structural };
}

// ─── interactions.json replay ─────────────────────────────────────────────────

// interactions.json step values may reference '${ENV_VAR_NAME}' instead of a literal string —
// resolved from process.env at replay time so credentials never sit as plain text in a JSON
// file (interactions.json lives under the gitignored features/ tree, but this keeps it out of
// even local plaintext where avoidable).
function resolveStepValue(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!match) return value;
  const resolved = process.env[match[1]];
  if (resolved === undefined) throw new Error(`interactions.json references undefined env var: ${match[1]}`);
  return resolved;
}

async function runInteractionStep(driver, step) {
  const el = step.target ? await driver.$(step.target) : null;
  switch (step.action) {
    case 'tap':
      await el.waitForDisplayed({ timeout: ACTION_TIMEOUT });
      await el.click();
      break;
    case 'setValue':
      // Uses 'mobile: type' (real IME keystrokes), not WebdriverIO's native setValue() —
      // on React Native apps setValue() sets the native field directly without firing
      // onChangeText, so the app's own validation/enabled-state never updates even though
      // the accessibility tree shows the text was set (confirmed by direct reproduction).
      await el.waitForDisplayed({ timeout: ACTION_TIMEOUT });
      await el.click();
      await driver.execute('mobile: type', { text: resolveStepValue(step.value) ?? '' });
      break;
    case 'waitFor':
      await el.waitForDisplayed({ timeout: ACTION_TIMEOUT, reverse: step.state === 'hidden' });
      break;
    case 'submitInvalid':
      await el.waitForDisplayed({ timeout: ACTION_TIMEOUT });
      await el.click(); // tap submit with an empty/invalid form
      break;
    case 'swipeUp':
      await driver
        .action('pointer')
        .move({ x: 200, y: 800 })
        .down()
        .move({ duration: 300, x: 200, y: 200 })
        .up()
        .perform();
      break;
    default:
      console.warn(`   ⚠️  unknown interaction action: ${step.action}`);
  }
}

async function runSteps(driver, steps, label) {
  if (!steps || !steps.length) return;
  console.log(`\n🎬 Replaying ${steps.length} ${label} step(s) ...`);
  for (const step of steps) {
    try {
      await runInteractionStep(driver, step);
      console.log(`   ▶ ${step.action}${step.note ? ` — ${step.note}` : ''}`);
    } catch (e) {
      console.warn(`   ⚠️  step failed (${step.action}): ${e.message?.split('\n')[0]}`);
    }
  }
}

// ─── Entry building + uniqueness validation ───────────────────────────────────

function buildEntry(platform, node, screenName, source) {
  const { primary, fallback } = toLocatorExpressions(platform, node.role, node);
  const typeLabel = ROLE_TYPE_LABEL[node.role] || node.role;
  return {
    primary,
    fallback,
    // Leave the platform override EMPTY here — MobileConfigLoader.getCandidates() tries
    // override.primary before entry.primary, so populating it with the same generic
    // classname-based `fallback` (as this used to do) made the ambiguous class selector win
    // over the more specific accessibility-id `primary` for every element that has one.
    // Confirmed: this caused an assertHidden() false-positive on a still-displayed unrelated
    // button matched by the generic Button classname selector. The override slot is reserved
    // for a genuinely BETTER platform-specific selector added during manual review (e.g. a
    // resourceId), not an auto-populated duplicate of the fallback.
    [platform]: {},
    type: typeLabel,
    description: `${node.role} "${node.name}" — extracted from ${screenName} (${platform})${
      source === 'interaction' ? ' after interaction' : ''
    }`,
    acRefs: [],
    source, // 'screen-scan' | 'structural' | 'interaction'
    status: 'captured',
  };
}

async function validateUniqueness(driver, platform, locators) {
  for (const entry of Object.values(locators)) {
    entry.matchCount = entry.matchCount || {};
    const override = entry[platform] || {};
    const candidates = [entry.codegenForm, override.primary, entry.primary, override.fallback, entry.fallback].filter(
      Boolean
    );
    let count = 0;
    for (const selector of candidates) {
      try {
        count = (await driver.$$(selector)).length;
      } catch {
        count = 0;
      }
      if (count > 0) break;
    }
    entry.matchCount[platform] = count;
    if (count === 0) {
      entry.status = 'missing';
      entry.validationNote = `no candidate selector matched on ${platform} for this screen snapshot`;
    } else if (count > 1) {
      entry.validationNote = `${platform} selector matches ${count} elements — may need scoping (Agent 2 mobile review)`;
    }
  }
}

// ─── Merge-preserving write ────────────────────────────────────────────────────

const PRESERVE_FIELDS = ['acRefs', 'finding', 'codegenForm', 'fragile', 'fragileNote', 'captureNote'];

function mergeScreen(existingScreen, freshScreen, platform) {
  const merged = { ...freshScreen };
  for (const [name, freshEntry] of Object.entries(freshScreen)) {
    const prev = existingScreen && existingScreen[name];
    if (!prev) continue;
    for (const f of PRESERVE_FIELDS) {
      if (prev[f] !== undefined && (freshEntry[f] === undefined || (Array.isArray(freshEntry[f]) && freshEntry[f].length === 0))) {
        freshEntry[f] = prev[f];
      }
    }
    // Never clobber the OTHER platform's data — only this run's platform is fresh.
    const otherPlatform = platform === 'android' ? 'ios' : 'android';
    if (prev[otherPlatform] && !freshEntry[otherPlatform]) freshEntry[otherPlatform] = prev[otherPlatform];
    if (prev.matchCount) freshEntry.matchCount = { ...prev.matchCount, ...freshEntry.matchCount };
    if (prev.status === 'captured' && freshEntry.status === 'missing') {
      freshEntry.statusNote = `re-extract found 0 matches on ${platform} but prior run had it captured — verify`;
    }
  }
  if (existingScreen) {
    for (const [name, prevEntry] of Object.entries(existingScreen)) {
      if (!merged[name]) merged[name] = prevEntry;
    }
  }
  return merged;
}

// ─── Caching ───────────────────────────────────────────────────────────────────

function cachePath(feature) {
  return path.join('features', 'mobile', feature, 'locators', '.extract_cache.json');
}
function readCache(feature) {
  const p = cachePath(feature);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}
function writeCache(feature, cache) {
  fs.mkdirSync(path.dirname(cachePath(feature)), { recursive: true });
  fs.writeFileSync(cachePath(feature), JSON.stringify(cache, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { feature, screen, platform, login, interactions, force, ...capArgs } = parseArgs();

  const { remote } = require('webdriverio');
  const capabilities = buildCapabilities(platform, capArgs);
  const serverUrl = new URL(process.env.APPIUM_SERVER_URL || 'http://localhost:4723');

  const interactionsPath = interactions || path.join('features', 'mobile', feature, 'locators', 'interactions.json');
  let allInteractions = {};
  if (fs.existsSync(interactionsPath)) {
    try {
      allInteractions = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
    } catch (e) {
      console.warn(`⚠️  could not parse ${interactionsPath}: ${e.message}`);
    }
  }
  const screenSteps = allInteractions[screen] || {};
  const loginSteps = login ? allInteractions[login]?.navigateSteps : null;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Auto Element Extractor (single-session, Appium)');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Feature      : ${feature}`);
  console.log(`  Screen       : ${screen}`);
  console.log(`  Platform     : ${platform}`);
  console.log(`  Login flow   : ${login || 'none'}`);
  console.log(`  Cache        : ${force ? 'bypassed (--force)' : 'enabled'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const driver = await remote({
    protocol: serverUrl.protocol.replace(':', ''),
    hostname: serverUrl.hostname,
    port: Number(serverUrl.port) || 4723,
    path: '/',
    logLevel: 'error',
    capabilities,
  });

  try {
    if (loginSteps?.length) await runSteps(driver, loginSteps, 'login');
    if (screenSteps.navigateSteps?.length) await runSteps(driver, screenSteps.navigateSteps, 'navigate-to-screen');

    // ── Page-source hash cache check ────────────────────────────────────────
    const finalPath = path.join('features', 'mobile', feature, 'locators', `${feature}_locators.json`);
    const pageSource = await driver.getPageSource();
    const domHash = crypto.createHash('sha1').update(pageSource).digest('hex');
    const cacheKey = `${screen}_${platform}`;
    const cache = readCache(feature);
    if (!force && cache[cacheKey]?.domHash === domHash && fs.existsSync(finalPath)) {
      console.log(`✅ Cache hit for ${screen}/${platform} (screen unchanged) — skipping. Use --force to override.\n`);
      return;
    }

    // ── 1. Interactive + structural scan (initial screen state) ─────────────
    const { interactive, structural } = await scanScreen(driver, platform);
    console.log(`📋 ${interactive.length} interactive + ${structural.length} structural element(s) found`);

    const locators = {};
    const addNodes = (list, source) => {
      for (const node of list) {
        const elemName = toElementName(node.role, node.name);
        if (!locators[elemName]) locators[elemName] = buildEntry(platform, node, screen, source);
      }
    };
    addNodes(interactive, 'screen-scan');
    addNodes(structural, 'structural');

    // ── 2. Replay declarative interactions to reveal dynamic elements ────────
    if (screenSteps.steps?.length) {
      console.log(`\n🎬 Replaying ${screenSteps.steps.length} interaction step(s) for dynamic elements ...`);
      for (const step of screenSteps.steps) {
        try {
          await runInteractionStep(driver, step);
          console.log(`   ▶ ${step.action}${step.note ? ` — ${step.note}` : ''}`);
          if (step.captureAfter) {
            const before = Object.keys(locators).length;
            const dyn = await scanScreen(driver, platform);
            for (const node of [...dyn.interactive, ...dyn.structural]) {
              const elemName = toElementName(node.role, node.name);
              if (!locators[elemName]) {
                const entry = buildEntry(platform, node, screen, 'interaction');
                entry.trigger = step.note || 'after interaction';
                locators[elemName] = entry;
              }
            }
            console.log(`     captured ${Object.keys(locators).length - before} new dynamic element(s)`);
          }
        } catch (e) {
          console.warn(`   ⚠️  step failed (${step.action}): ${e.message?.split('\n')[0]}`);
        }
      }
    }

    // ── 3. Uniqueness validation in the SAME session ────────────────────────
    console.log(`\n🔎 Validating ${Object.keys(locators).length} selector(s) (matchCount) ...`);
    await validateUniqueness(driver, platform, locators);
    const missing = Object.values(locators).filter((e) => e.status === 'missing').length;
    const ambiguous = Object.values(locators).filter((e) => (e.matchCount?.[platform] ?? 0) > 1).length;
    console.log(`   captured=${Object.keys(locators).length - missing}  missing=${missing}  ambiguous(>1)=${ambiguous}`);

    // ── 4a. Raw audit snapshot (overwrite-safe) ──────────────────────────────
    const rawPath = path.join('features', 'mobile', feature, 'locators', `extract_${feature}_mobile_auto.json`);
    let rawExisting = {};
    if (fs.existsSync(rawPath)) {
      try {
        rawExisting = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
      } catch {
        rawExisting = {};
      }
    }
    const rawOut = {
      metadata: {
        ...(rawExisting.metadata || {}),
        feature,
        dateGenerated: new Date().toISOString().split('T')[0],
        source: 'auto_element_extractor.js (single-session)',
        platform,
      },
      ...rawExisting,
      [screen]: locators,
    };
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(rawOut, null, 2));

    // ── 4b. Final merge-preserving locators file ─────────────────────────────
    let finalExisting = {};
    if (fs.existsSync(finalPath)) {
      try {
        finalExisting = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
      } catch {
        finalExisting = {};
      }
    }
    const mergedScreen = mergeScreen(finalExisting[screen], locators, platform);
    const finalOut = {
      ...finalExisting,
      metadata: {
        ...(finalExisting.metadata || {}),
        feature,
        dateGenerated: new Date().toISOString().split('T')[0],
        autoExtractorSource: rawPath,
      },
      [screen]: mergedScreen,
    };
    fs.writeFileSync(finalPath, JSON.stringify(finalOut, null, 2));

    // ── Update cache ─────────────────────────────────────────────────────────
    cache[cacheKey] = { domHash, dateGenerated: new Date().toISOString().split('T')[0] };
    writeCache(feature, cache);

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Extraction Complete');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Final locators : ${finalPath}`);
    console.log(`  Raw snapshot   : ${rawPath}`);
    console.log('');
    console.log('  Agent 2 (mobile) next: assign acRefs from spec; review missing/ambiguous;');
    console.log('  re-run with --platform ios|android to fill in the other platform; only use');
    console.log('  Appium Inspector for elements no interaction step could reach.');
    console.log('══════════════════════════════════════════════════════════\n');
  } finally {
    await driver.deleteSession().catch(() => {});
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
