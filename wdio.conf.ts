import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { browser } from '@wdio/globals';
import type { Options, Capabilities } from '@wdio/types';
dotenv.config();

/**
 * WebdriverIO Configuration — mobile (Appium) pipeline.
 * Mirrors playwright.config.ts's role for the web pipeline: single source of truth for
 * reporter paths that Agent 4 (mobile) depends on. Do NOT pass --reporter on the CLI.
 */

const ACTION_TIMEOUT = Number(process.env.ACTION_TIMEOUT) || 90000;
const RESULTS_DIR = path.resolve(__dirname, 'reports/mobile/test-results');
const SCREENSHOTS_DIR = path.resolve(__dirname, 'reports/mobile/screenshots');

function buildAndroidCapabilities(): WebdriverIO.Capabilities | null {
  const apkPath = process.env.ANDROID_APK_PATH;
  const caps: WebdriverIO.Capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.ANDROID_DEVICE_NAME || 'Android Emulator',
    'appium:newCommandTimeout': 120,
    // Default (20s) can be too short for a cold app-process start on a loaded dev machine —
    // observed 'am start-activity -W ... timed out after 20000ms' failures otherwise.
    'appium:adbExecTimeout': 60000,
  };
  if (process.env.ANDROID_PLATFORM_VERSION) caps['appium:platformVersion'] = process.env.ANDROID_PLATFORM_VERSION;

  if (apkPath && fs.existsSync(apkPath)) {
    caps['appium:app'] = path.resolve(apkPath);
  } else if (process.env.ANDROID_APP_PACKAGE && process.env.ANDROID_APP_ACTIVITY) {
    caps['appium:appPackage'] = process.env.ANDROID_APP_PACKAGE;
    caps['appium:appActivity'] = process.env.ANDROID_APP_ACTIVITY;
  } else {
    return null; // not configured — omit this capability set
  }
  return caps;
}

function buildIosCapabilities(): WebdriverIO.Capabilities | null {
  const ipaPath = process.env.IOS_IPA_PATH;
  const appPath = process.env.IOS_APP_PATH;
  const caps: WebdriverIO.Capabilities = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': process.env.IOS_DEVICE_NAME || 'iPhone Simulator',
    'appium:newCommandTimeout': 120,
  };
  if (process.env.IOS_PLATFORM_VERSION) caps['appium:platformVersion'] = process.env.IOS_PLATFORM_VERSION;
  if (process.env.IOS_UDID) caps['appium:udid'] = process.env.IOS_UDID;

  // .ipa (real device, requires a UDID) and .app (simulator) are not interchangeable.
  if (process.env.IOS_UDID && ipaPath && fs.existsSync(ipaPath)) {
    caps['appium:app'] = path.resolve(ipaPath);
  } else if (appPath && fs.existsSync(appPath)) {
    caps['appium:app'] = path.resolve(appPath);
  } else if (process.env.IOS_BUNDLE_ID) {
    caps['appium:bundleId'] = process.env.IOS_BUNDLE_ID;
  } else {
    return null; // not configured — omit this capability set
  }
  return caps;
}

const capabilities: Capabilities.RequestedStandaloneCapabilities[] = [
  buildAndroidCapabilities(),
  buildIosCapabilities(),
].filter((c): c is WebdriverIO.Capabilities => c !== null);

export const config: Options.Testrunner & Capabilities.WithRequestedTestrunnerCapabilities = {
  runner: 'local',
  // TypeScript support (tsx) is auto-detected by @wdio/cli — no compile config needed here.

  specs: ['./features/mobile/**/tests/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1, // one device/emulator session at a time by default
  capabilities,

  logLevel: 'info',
  bail: 0,
  waitforTimeout: ACTION_TIMEOUT,
  connectionRetryTimeout: 120000,
  // Small safety margin above the default for a slow cold-start Appium child process — the
  // actual ECONNREFUSED root cause was a loopback address mismatch (see the appium service
  // config below), not a timing race, but a bit of retry headroom is still cheap insurance.
  connectionRetryCount: 5,

  services: [
    [
      'appium',
      {
        command: 'appium',
        // '127.0.0.1', not 'localhost' — on this machine 'localhost' resolves to the IPv6
        // loopback (::1), but WebdriverIO's session request explicitly targets 127.0.0.1 (IPv4).
        // That mismatch caused every session-creation attempt to ECONNREFUSED even though the
        // server logged itself as "started" (it was listening, just not on the address the
        // client actually connects to).
        args: { address: '127.0.0.1' },
      },
    ],
  ],

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: ACTION_TIMEOUT,
  },

  // Do NOT override these paths on the CLI — Agent 4 (mobile) reads RESULTS_DIR/results.json.
  reporters: [
    'spec',
    ['json', { outputDir: RESULTS_DIR }],
    ['junit', { outputDir: RESULTS_DIR, outputFileFormat: () => 'junit.xml' }],
  ],

  afterTest: async function (test, _context, { passed }) {
    if (passed) return;
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${test.parent}-${test.title}-${ts}`.replace(/[^a-zA-Z0-9-_]/g, '_');
    // Tolerate failures where the session is already gone (e.g. a Mocha-level timeout) —
    // Agent 4 (mobile) treats a missing screenshot as expected for that failure class.
    await browser.saveScreenshot(path.join(SCREENSHOTS_DIR, `${fileName}.png`)).catch(() => {});
  },

  onComplete: async function () {
    // @wdio/json-reporter writes one file per session by default — merge them into the
    // single results.json Agent 4 (mobile) expects (preserves the web pipeline's "one
    // hand-off file" convention instead of redesigning Agent 4 around a directory scan).
    // The module's CJS interop shape varies by loader — sometimes a named `mergeResults`
    // export, sometimes everything wrapped under `.default` (confirmed: this project's runtime
    // resolves the latter). It's also async — all of this must be handled or this hook throws /
    // races the merge write.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mergeResultsModule = require('@wdio/json-reporter/mergeResults');
    const mergeResults = mergeResultsModule.mergeResults || mergeResultsModule.default || mergeResultsModule;
    try {
      await mergeResults(RESULTS_DIR, 'wdio-.*-json-reporter.json', 'results.json');
    } catch (e) {
      // No per-session JSON files yet (e.g. every session failed before any spec ran) —
      // don't let a missing results directory crash reporting.
      console.warn(`mergeResults skipped: ${(e as Error).message}`);
    }
  },
};
