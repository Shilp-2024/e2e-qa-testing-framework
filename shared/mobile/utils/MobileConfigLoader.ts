/**
 * MobileConfigLoader — Appium/WebdriverIO equivalent of shared/utils/ConfigLoader.ts.
 *
 * WebdriverIO selectors have no native `.or()` chaining (unlike Playwright's
 * Locator.or()), so resolveElement() tries each candidate selector in order —
 * codegenForm -> primary -> platform-specific fallback -> shared fallback —
 * and returns the first one that actually matches an element on the current
 * platform/session, mirroring ConfigLoader.toLocator()'s runtime-fallback intent.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Browser as WdioBrowser, Element as WdioElement } from 'webdriverio';

export type MobilePlatform = 'android' | 'ios';

interface PlatformOverride {
  primary?: string;
  fallback?: string;
}

interface MobileLocatorConfig {
  /** Appium-Inspector-verified selector — highest priority when present and not a placeholder. */
  codegenForm?: string;
  primary: string;
  fallback?: string;
  description?: string;
  android?: PlatformOverride;
  ios?: PlatformOverride;
}

interface ScreenConfig {
  [element: string]: MobileLocatorConfig;
}

interface FeatureConfig {
  metadata?: Record<string, unknown>;
  [screen: string]: ScreenConfig | Record<string, unknown> | undefined;
}

/** Values that mark a locator field as "not a real selector" — skipped during resolution. */
const PLACEHOLDER_VALUES = new Set(['', 'MISSING', 'FINDING', 'PENDING', 'TODO']);

function isRealExpr(expr?: string): expr is string {
  return typeof expr === 'string' && !PLACEHOLDER_VALUES.has(expr.trim());
}

export class MobileConfigLoader {
  private static configCache: Map<string, any> = new Map();
  private static configDir: string = path.resolve(__dirname, '../../../features/mobile');

  /**
   * Load locator configuration for a specific mobile feature.
   * @throws Error if the config file is not found.
   */
  static loadLocators(featureName: string): FeatureConfig {
    const cacheKey = `locators_${featureName}`;
    if (this.configCache.has(cacheKey)) return this.configCache.get(cacheKey);

    const configPath = path.join(
      this.configDir,
      featureName,
      'locators',
      `${featureName}_locators.json`
    );
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Mobile locator config not found: ${configPath}\n` +
          `Please create ${featureName}_locators.json in features/mobile/${featureName}/locators/`
      );
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    this.configCache.set(cacheKey, config);
    return config;
  }

  /**
   * Load test data configuration for a specific mobile feature.
   * @throws Error if the config file is not found.
   */
  static loadTestData(featureName: string): any {
    const cacheKey = `testdata_${featureName}`;
    if (this.configCache.has(cacheKey)) return this.configCache.get(cacheKey);

    const configPath = path.join(
      this.configDir,
      featureName,
      'testData',
      `${featureName.toLowerCase()}.json`
    );
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Mobile test data config not found: ${configPath}\n` +
          `Please create ${featureName.toLowerCase()}.json in features/mobile/${featureName}/testData/`
      );
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    this.configCache.set(cacheKey, config);
    return config;
  }

  /** Get the raw locator entry object for a feature/screen/element. */
  static getElement(featureName: string, screenName: string, elementName: string): MobileLocatorConfig {
    const config = this.loadLocators(featureName);
    const screen = config[screenName] as ScreenConfig | undefined;
    if (!screen) {
      throw new Error(`Screen '${screenName}' not found in ${featureName} mobile locators`);
    }
    const entry = screen[elementName];
    if (!entry) {
      throw new Error(
        `Element '${elementName}' not found for screen '${screenName}' in ${featureName} mobile locators`
      );
    }
    return entry;
  }

  /**
   * Ordered candidate selector strings for the given platform:
   * codegenForm -> primary -> platform-specific fallback -> shared fallback.
   */
  static getCandidates(entry: MobileLocatorConfig, platform: MobilePlatform): string[] {
    const override = entry[platform];
    return [entry.codegenForm, override?.primary, entry.primary, override?.fallback, entry.fallback].filter(
      isRealExpr
    );
  }

  /**
   * Resolve a locator by feature/screen/element keys into a live WebdriverIO element.
   * Tries each candidate selector in order and returns the first that matches at least
   * one element in the current session on the current platform.
   *
   * Polls the whole candidate list for up to `timeout` instead of a single instantaneous pass.
   * Confirmed root cause of a real bug: right after an app relaunch (or any screen transition),
   * the UI may still be on a splash/transitional screen for the first moment(s) this is called —
   * a one-shot lookup found zero matches every time and either threw immediately or resolved to
   * nothing, even though the target screen appeared a second later.
   *
   * `timeout` defaults to a SHORT window (5s), not ACTION_TIMEOUT (90s) — callers like
   * `tap()`/`setValue()` already wrap the returned element in their own 90s
   * `el.waitForDisplayed()`. A first version of this fix defaulted to 90s here too, which stacked
   * with that outer wait: one flaky lookup could cost up to ~180s instead of ~90s. This is meant
   * only to survive the brief splash/transition gap; the outer wait still provides the real
   * long-tail retry.
   */
  static async resolveElement(
    driver: WdioBrowser,
    featureName: string,
    screenName: string,
    elementName: string,
    platform: MobilePlatform,
    timeout = 5000
  ): Promise<WdioElement> {
    const entry = this.getElement(featureName, screenName, elementName);
    const candidates = this.getCandidates(entry, platform);
    if (candidates.length === 0) {
      throw new Error(
        `Mobile locator entry has no usable selector for platform '${platform}' ` +
          `(codegenForm/primary/fallback all missing): ${JSON.stringify(entry)}`
      );
    }
    const deadline = Date.now() + timeout;
    while (true) {
      for (const selector of candidates) {
        const matches = await driver.$$(selector).getElements().catch(() => []);
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
          // Ambiguous match — confirmed real cause of a hang: React Native apps often duplicate
          // the same accessibility label across nested wrapper Views (one screen had the same
          // validation-message text on 10 different nodes), and array order isn't guaranteed to
          // put the visible one first. Prefer whichever candidate is actually displayed; only
          // fall back to the first if none report displayed (e.g. still mid-transition).
          for (const el of matches) {
            if (await el.isDisplayed().catch(() => false)) return el;
          }
          return matches[0];
        }
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    // Nothing matched within the timeout — return the last candidate anyway so the caller gets
    // a real WebdriverIO "element not found" error pointing at a concrete selector.
    return driver.$(candidates[candidates.length - 1]).getElement();
  }

  /** Clear the configuration cache (useful for testing / forced re-reads). */
  static clearCache(): void {
    this.configCache.clear();
  }

  /** Get configuration directory path. */
  static getConfigDir(): string {
    return this.configDir;
  }
}
