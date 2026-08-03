/**
 * Common assertion helpers for Appium/WebdriverIO — generic, project-agnostic.
 * Mirrors shared/assertions/common.ts's naming so both pipelines read the same.
 */

import { expect } from '@wdio/globals';
import type { Browser as WdioBrowser, Element as WdioElement } from 'webdriverio';
import { ACTION_TIMEOUT } from '../utils/timeouts';

/** Assert an element is displayed. */
export async function assertDisplayed(
  el: WdioElement,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await expect(el).toBeDisplayed({ wait: timeout });
}

/** Assert an element is hidden / not present. */
export async function assertHidden(
  el: WdioElement,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await expect(el).not.toBeDisplayed({ wait: timeout });
}

/** Assert an element's text matches (sub)string or pattern. */
export async function assertText(
  el: WdioElement,
  expected: string | RegExp,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await expect(el).toHaveText(expected, { wait: timeout });
}

/** Assert a selector resolves to exactly `count` matches on the current screen. */
export async function assertElementsCount(
  driver: WdioBrowser,
  selector: string,
  count: number,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await driver.waitUntil(async () => (await driver.$$(selector).getElements()).length === count, {
    timeout,
    timeoutMsg: `Expected ${count} elements for selector '${selector}'`,
  });
}
