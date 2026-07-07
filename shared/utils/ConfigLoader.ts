/**
 * ConfigLoader Utility
 * Provides centralized access to feature-specific configurations (locators, test data, etc.)
 * Supports loading JSON configs and provides TypeScript type safety
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Page, Locator } from '@playwright/test';

interface LocatorConfig {
  /** Codegen-verified expression — highest priority when present and not a placeholder. */
  codegenForm?: string;
  primary: string;
  fallback?: string;
  description?: string;
}

/** Values that mark a locator field as "not a real selector" — skipped during resolution. */
const PLACEHOLDER_VALUES = new Set(['', 'MISSING', 'FINDING', 'PENDING', 'TODO']);

function isRealExpr(expr?: string): expr is string {
  return typeof expr === 'string' && !PLACEHOLDER_VALUES.has(expr.trim());
}

interface FeatureConfig {
  [page: string]: {
    [element: string]: LocatorConfig;
  };
}

export class ConfigLoader {
  private static configCache: Map<string, any> = new Map();
  private static configDir: string = path.resolve(__dirname, '../../features');

  /**
   * Load locator configuration for a specific feature
   * @param featureName - Folder name of the feature (e.g., 'UserLogin', 'PatientManagement')
   * @returns FeatureConfig with all locators for the feature
   * @throws Error if config file not found
   */
  static loadLocators(featureName: string): FeatureConfig {
    const cacheKey = `locators_${featureName}`;

    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey);
    }

    const configPath = path.join(
      this.configDir,
      featureName,
      'locators',
      `${featureName}_locators.json`
    );

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Locator config not found: ${configPath}\n` +
        `Please create ${featureName}_locators.json in features/${featureName}/locators/`
      );
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    // Cache the config
    this.configCache.set(cacheKey, config);

    return config;
  }

  /**
   * Load test data configuration for a specific feature
   * @param featureName - Folder name of the feature (e.g., 'UserLogin', 'PatientManagement')
   * @returns Test data object with all test scenarios
   * @throws Error if config file not found
   */
  static loadTestData(featureName: string): any {
    const cacheKey = `testdata_${featureName}`;

    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey);
    }

    const configPath = path.join(
      this.configDir,
      featureName,
      'testData',
      `${featureName.toLowerCase()}.json`
    );

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Test data config not found: ${configPath}\n` +
        `Please create ${featureName.toLowerCase()}.json in features/${featureName}/testData/`
      );
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    this.configCache.set(cacheKey, config);

    return config;
  }

  /**
   * Get a specific locator with primary/fallback strategy
   * @param featureName - Feature name (e.g., 'auth')
   * @param pageName - Page name (e.g., 'loginPage')
   * @param elementName - Element name (e.g., 'emailInput')
   * @returns Combined selector string: "primary, fallback"
   */
  static getLocator(
    featureName: string,
    pageName: string,
    elementName: string
  ): string {
    const config = this.loadLocators(featureName);

    if (!config[pageName]) {
      throw new Error(
        `Page '${pageName}' not found in ${featureName}.locators.json`
      );
    }

    if (!config[pageName][elementName]) {
      throw new Error(
        `Element '${elementName}' not found for page '${pageName}' in ${featureName}.locators.json`
      );
    }

    const locator: LocatorConfig = config[pageName][elementName];

    // Return primary selector, with fallback if available
    if (locator.fallback) {
      return `${locator.primary}, ${locator.fallback}`;
    }

    return locator.primary;
  }

  /**
   * Get all locators for a specific page
   * @param featureName - Feature name
   * @param pageName - Page name (e.g., 'loginPage')
   * @returns Object with all locators for that page
   */
  static getPageLocators(
    featureName: string,
    pageName: string
  ): { [element: string]: LocatorConfig } {
    const config = this.loadLocators(featureName);

    if (!config[pageName]) {
      throw new Error(
        `Page '${pageName}' not found in ${featureName}.locators.json`
      );
    }

    return config[pageName];
  }

  /**
   * Evaluate a stored Playwright locator expression string (e.g.
   * "page.getByRole('button', { name: 'Save' })") into a live Locator.
   * The expression references `page` only; locator JSON is trusted in-repo config.
   * @param page - Playwright Page
   * @param expr - A Playwright locator expression as a string
   * @returns The resolved Locator
   */
  static evalLocatorExpr(page: Page, expr: string): Locator {
    // eslint-disable-next-line no-new-func
    const fn = new Function('page', `return (${expr});`) as (p: Page) => Locator;
    return fn(page);
  }

  /**
   * Resolve a locator entry into a single live Locator with RUNTIME fallback.
   * Tries codegenForm → primary → fallback, chaining them with Playwright's
   * native `.or()` so whichever actually matches the live DOM is used at
   * execution time (instead of choosing one at generation time).
   * @param page - Playwright Page
   * @param entry - A locator config entry (or page+element keys)
   * @returns A Locator matching the first available candidate that resolves
   * @throws Error if the entry has no real selector candidates
   */
  static toLocator(page: Page, entry: LocatorConfig): Locator {
    const candidates = [entry.codegenForm, entry.primary, entry.fallback].filter(isRealExpr);
    if (candidates.length === 0) {
      throw new Error(
        `Locator entry has no usable selector (codegenForm/primary/fallback all missing): ` +
        `${JSON.stringify(entry)}`
      );
    }
    let resolved: Locator | undefined;
    for (const expr of candidates) {
      const candidate = this.evalLocatorExpr(page, expr);
      resolved = resolved ? resolved.or(candidate) : candidate;
    }
    return resolved as Locator;
  }

  /**
   * Convenience: resolve a locator by feature/page/element keys into a live Locator
   * with runtime fallback. Used by BasePage.
   */
  static resolveLocator(
    page: Page,
    featureName: string,
    pageName: string,
    elementName: string
  ): Locator {
    return this.toLocator(page, this.getElement(featureName, pageName, elementName));
  }

  /**
   * Get the raw locator entry object for a feature/page/element.
   */
  static getElement(
    featureName: string,
    pageName: string,
    elementName: string
  ): LocatorConfig {
    const config = this.loadLocators(featureName);
    if (!config[pageName]) {
      throw new Error(`Page '${pageName}' not found in ${featureName} locators`);
    }
    if (!config[pageName][elementName]) {
      throw new Error(
        `Element '${elementName}' not found for page '${pageName}' in ${featureName} locators`
      );
    }
    return config[pageName][elementName] as LocatorConfig;
  }

  /**
   * Clear the configuration cache (useful for testing)
   */
  static clearCache(): void {
    this.configCache.clear();
  }

  /**
   * Get configuration directory path
   * @returns Full path to config directory
   */
  static getConfigDir(): string {
    return this.configDir;
  }

  /**
   * List all available feature configs
   * @param configType - Type of config: 'locators' or 'testdata'
   * @returns Array of available feature config files
   */
  static listAvailableConfigs(configType: 'locators' | 'testdata' = 'locators'): string[] {
    if (!fs.existsSync(this.configDir)) return [];

    return fs.readdirSync(this.configDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(featureName => {
        const subDir = configType === 'locators' ? 'locators' : 'testData';
        return fs.existsSync(path.join(this.configDir, featureName, subDir));
      });
  }
}

/**
 * Usage Examples:
 * 
 * // Get single locator with fallback
 * const emailInputSelector = ConfigLoader.getLocator('auth', 'loginPage', 'emailInput');
 * // Returns: "input#UserName, input[name=\"UserName\"]"
 * 
 * // Use in Page Object
 * this.emailInput = page.locator(
 *   ConfigLoader.getLocator('auth', 'loginPage', 'emailInput')
 * ).first();
 * 
 * // Get all locators for a page
 * const pageLocators = ConfigLoader.getPageLocators('auth', 'loginPage');
 * // Returns: { emailInput: {...}, passwordInput: {...}, ... }
 * 
 * // Get test data
 * const testData = ConfigLoader.loadTestData('auth');
 * // Returns: { validLogin: {...}, invalidEmail: {...}, ... }
 * 
 * // List available configs
 * const features = ConfigLoader.listAvailableConfigs('locators');
 * // Returns: ['auth', 'patient', 'billing']
 */
