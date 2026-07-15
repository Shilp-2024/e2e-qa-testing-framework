/**
 * Common assertion helpers — generic, project-agnostic.
 * Standardizes the timeout-wrapped expect() calls repeated across every spec, and
 * keeps assertion strings sourced from test data rather than scattered literals.
 */

import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { ACTION_TIMEOUT } from '../utils/timeouts';

/** Assert an element is visible. */
export async function assertVisible(
  locator: Locator,
  message?: string,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await expect(locator, message).toBeVisible({ timeout });
}

/** Assert an element is hidden / not present. */
export async function assertHidden(
  locator: Locator,
  message?: string,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await expect(locator, message).toBeHidden({ timeout });
}

/** Assert an element contains the expected (sub)text. */
export async function assertText(
  locator: Locator,
  expected: string | RegExp,
  message?: string,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await expect(locator, message).toContainText(expected, { timeout });
}

/** Assert an element resolves to exactly `count` matches. */
export async function assertCount(
  locator: Locator,
  count: number,
  message?: string,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await expect(locator, message).toHaveCount(count, { timeout });
}

/** Assert the current page URL matches (substring or regex). */
export async function assertUrl(
  locator: { waitForURL: (url: string | RegExp, opts?: { timeout?: number }) => Promise<void> },
  expected: string | RegExp,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await locator.waitForURL(expected, { timeout });
}
