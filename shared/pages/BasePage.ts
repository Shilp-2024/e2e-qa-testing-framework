/**
 * BasePage — generic, project-agnostic page-object base class.
 *
 * Every generated page object extends this. It collapses the navigate/click/fill/verify
 * boilerplate repeated across all page objects and — most importantly — resolves every
 * locator through ConfigLoader.toLocator(), which tries codegenForm → primary → fallback
 * at RUNTIME (via Playwright `.or()`). The "which selector wins" decision moves from
 * generation time to execution time, eliminating the whole class of "wrong locator chosen
 * while generating" failures.
 *
 * Element access is by key: loc(pageName, elementName) — keys come from the feature's
 * locator JSON. Page objects hold no hand-written selector strings.
 */

import type { Page, Locator } from '@playwright/test';
import { ConfigLoader } from '../utils/ConfigLoader';
import { ACTION_TIMEOUT } from '../utils/timeouts';
import { waitForStable, waitForEnabled } from '../utils/waits';

export abstract class BasePage {
  protected readonly page: Page;
  /** Feature folder name — used to load this feature's locator JSON. */
  protected readonly feature: string;

  constructor(page: Page, feature: string) {
    this.page = page;
    this.feature = feature;
  }

  /**
   * Resolve a locator by page/element key into a live Locator with runtime fallback.
   */
  protected loc(pageName: string, elementName: string): Locator {
    return ConfigLoader.resolveLocator(this.page, this.feature, pageName, elementName);
  }

  /** Navigate to a relative path and wait for DOM content to load. */
  async goto(pathName: string): Promise<void> {
    await this.page.goto(pathName);
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Click an element (resolved by key). */
  protected async click(pageName: string, elementName: string): Promise<void> {
    await this.loc(pageName, elementName).click({ timeout: ACTION_TIMEOUT });
  }

  /** Fill a text field (resolved by key). */
  protected async fill(pageName: string, elementName: string, value: string): Promise<void> {
    await this.loc(pageName, elementName).fill(value, { timeout: ACTION_TIMEOUT });
  }

  /** Select an option in a native <select> (resolved by key). */
  protected async selectOption(
    pageName: string,
    elementName: string,
    value: string
  ): Promise<void> {
    await this.loc(pageName, elementName).selectOption(value, { timeout: ACTION_TIMEOUT });
  }

  /** Get trimmed text content of an element (resolved by key). */
  protected async getText(pageName: string, elementName: string): Promise<string> {
    const text = await this.loc(pageName, elementName).textContent({ timeout: ACTION_TIMEOUT });
    return (text ?? '').trim();
  }

  /** Wait for an element to stop animating (replaces blind sleeps after open/transition). */
  protected async waitStable(pageName: string, elementName: string): Promise<void> {
    await waitForStable(this.loc(pageName, elementName));
  }

  /** Wait for a control to become enabled (e.g. dependent dropdown). */
  protected async waitEnabled(pageName: string, elementName: string): Promise<void> {
    await waitForEnabled(this.loc(pageName, elementName));
  }
}
