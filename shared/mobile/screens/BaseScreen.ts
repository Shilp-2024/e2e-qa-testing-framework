/**
 * BaseScreen — Appium/WebdriverIO equivalent of shared/pages/BasePage.ts.
 *
 * Every generated screen object extends this. Element access is by key —
 * loc(elementName) resolves through MobileConfigLoader.resolveElement(), which
 * tries codegenForm -> primary -> platform-specific fallback -> shared fallback
 * and returns the first selector that actually matches on the current platform.
 * Screen objects hold no hand-written selector strings.
 */

import type { Browser as WdioBrowser, Element as WdioElement } from 'webdriverio';
import { MobileConfigLoader, MobilePlatform } from '../utils/MobileConfigLoader';
import { ACTION_TIMEOUT } from '../utils/timeouts';
import { waitForStable, waitForEnabled } from '../utils/waits';

export abstract class BaseScreen {
  protected readonly driver: WdioBrowser;
  /** Feature folder name — used to load this feature's mobile locator JSON. */
  protected readonly feature: string;
  /** Screen key — the top-level key in the locator JSON for this screen. */
  protected readonly screen: string;
  protected readonly platform: MobilePlatform;

  constructor(driver: WdioBrowser, feature: string, screen: string) {
    this.driver = driver;
    this.feature = feature;
    this.screen = screen;
    this.platform = String(driver.capabilities?.platformName ?? '').toLowerCase().startsWith('ios')
      ? 'ios'
      : 'android';
  }

  /** Resolve a locator by element key into a live WebdriverIO element with runtime fallback. */
  protected async loc(elementName: string): Promise<WdioElement> {
    return MobileConfigLoader.resolveElement(this.driver, this.feature, this.screen, elementName, this.platform);
  }

  /** Tap an element (resolved by key). */
  async tap(elementName: string): Promise<void> {
    const el = await this.loc(elementName);
    await el.waitForDisplayed({ timeout: ACTION_TIMEOUT });
    await el.click();
  }

  /**
   * Enter text into a field (resolved by key).
   *
   * Uses the `mobile: type` execute script rather than WebdriverIO's native `setValue()`.
   * On React Native apps (confirmed via direct reproduction on a real RN app under test),
   * `setValue()` sets the native EditText's text directly without dispatching real key
   * events, so the JS `onChangeText` handler never fires — the field looks filled in the
   * accessibility tree, but the app's own validation/enabled-state never updates. `mobile:
   * type` simulates real IME keystrokes and is understood by both UiAutomator2 and XCUITest.
   */
  async setValue(elementName: string, value: string): Promise<void> {
    const el = await this.loc(elementName);
    await el.waitForDisplayed({ timeout: ACTION_TIMEOUT });
    await el.click();
    await this.driver.execute('mobile: type', { text: value });
  }

  /** Get trimmed text content of an element (resolved by key). */
  async getText(elementName: string): Promise<string> {
    const el = await this.loc(elementName);
    return (await el.getText()).trim();
  }

  /** Wait for an element to stop moving (replaces blind sleeps after a screen transition). */
  async waitStable(elementName: string): Promise<void> {
    const el = await this.loc(elementName);
    await waitForStable(this.driver, el);
  }

  /** Wait for a control to become enabled. */
  async waitEnabled(elementName: string): Promise<void> {
    const el = await this.loc(elementName);
    await waitForEnabled(el);
  }

  /**
   * Tap at a position expressed as a fraction of screen width/height (0-1), rather than an
   * absolute pixel or a resolved element. Confirmed necessary for at least one real element (the
   * Today Dashboard's "+" FAB, a React Native Pressable with no accessible name): its
   * accessibility-node `click()` action routed to a DIFFERENT handler than an actual tap at its
   * visual position — clicking it via the normal `tap(elementName)` path opened the wrong screen
   * every time, while a coordinate tap at the same visual spot worked correctly. Relative (not
   * absolute) coordinates so this isn't hardcoded to one device resolution.
   */
  async tapAtRelative(xPct: number, yPct: number): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    const x = Math.floor(width * xPct);
    const y = Math.floor(height * yPct);
    await this.driver.action('pointer').move({ x, y }).down().pause(100).up().perform();
  }

  /** Swipe a full screen-height/width gesture in the given direction. */
  async swipe(direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    const midX = Math.floor(width / 2);
    const midY = Math.floor(height / 2);
    const points: Record<typeof direction, [number, number, number, number]> = {
      up: [midX, Math.floor(height * 0.8), midX, Math.floor(height * 0.2)],
      down: [midX, Math.floor(height * 0.2), midX, Math.floor(height * 0.8)],
      left: [Math.floor(width * 0.8), midY, Math.floor(width * 0.2), midY],
      right: [Math.floor(width * 0.2), midY, Math.floor(width * 0.8), midY],
    };
    const [startX, startY, endX, endY] = points[direction];
    await this.driver
      .action('pointer')
      .move({ x: startX, y: startY })
      .down()
      .move({ duration: 300, x: endX, y: endY })
      .up()
      .perform();
  }

  /** Long-press an element for the given duration (resolved by key). */
  async longPress(elementName: string, durationMs: number = 1000): Promise<void> {
    const el = await this.loc(elementName);
    await el.waitForDisplayed({ timeout: ACTION_TIMEOUT });
    const location = await el.getLocation();
    const size = await el.getSize();
    const x = Math.floor(location.x + size.width / 2);
    const y = Math.floor(location.y + size.height / 2);
    await this.driver.action('pointer').move({ x, y }).down().pause(durationMs).up().perform();
  }

  /** Swipe up repeatedly until an element (by key) is displayed, or throw after maxSwipes. */
  async scrollToElement(elementName: string, maxSwipes: number = 6): Promise<WdioElement> {
    for (let i = 0; i < maxSwipes; i++) {
      const el = await this.loc(elementName);
      if (await el.isDisplayed().catch(() => false)) return el;
      await this.swipe('up');
    }
    throw new Error(`scrollToElement: '${elementName}' not found on '${this.screen}' after ${maxSwipes} swipes`);
  }

  /** Dismiss the on-screen keyboard, if shown (no-op otherwise). */
  async hideKeyboard(): Promise<void> {
    await this.driver.hideKeyboard().catch(() => {});
  }

  /**
   * Restart the app under test fresh, WITHOUT tearing down the Appium session.
   *
   * Uses terminateApp + activateApp (a few seconds) instead of reloadSession() (which recreates
   * the entire WebDriver session — full UiAutomator2/XCUITest bootstrap, ~30-45s observed).
   * Confirmed: with reloadSession() in every beforeEach, a 13-test file took ~6-10 minutes purely
   * on relaunch overhead, making even a priority-filtered run barely faster than running
   * everything. Falls back to reloadSession() only if the app identifier isn't in capabilities
   * (e.g. installed via an `appium:app` path rather than appPackage/bundleId).
   */
  async resetApp(): Promise<void> {
    const caps = this.driver.capabilities as Record<string, unknown>;
    const appId = (this.platform === 'ios' ? caps['bundleId'] : caps['appPackage']) as string | undefined;
    if (!appId) {
      await this.driver.reloadSession();
      return;
    }
    await this.driver.execute('mobile: terminateApp', { appId });
    await this.driver.execute('mobile: activateApp', { appId });
  }
}
