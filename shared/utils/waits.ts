/**
 * Deterministic wait helpers — generic, project-agnostic.
 *
 * Purpose: REPLACE `page.waitForTimeout(ms)` sleeps. Blind sleeps are the #1 source of
 * flakiness and wasted wall-clock. Every helper here waits for an observable condition.
 */

import type { Page, Locator } from '@playwright/test';
import { ACTION_TIMEOUT, SETTLE_TIMEOUT } from './timeouts';

/**
 * Wait until an element has stopped moving/animating (its bounding box is stable
 * across two consecutive animation frames). Use after opening menus/modals/dropdowns
 * instead of a fixed sleep.
 */
export async function waitForStable(
  locator: Locator,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout });
  await locator.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        let lastRect = el.getBoundingClientRect();
        let stableFrames = 0;
        const tick = () => {
          const rect = el.getBoundingClientRect();
          const same =
            rect.x === lastRect.x &&
            rect.y === lastRect.y &&
            rect.width === lastRect.width &&
            rect.height === lastRect.height;
          stableFrames = same ? stableFrames + 1 : 0;
          lastRect = rect;
          if (stableFrames >= 3) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
}

/**
 * Wait until a control is enabled (not disabled / not aria-disabled). Use for fields
 * that unlock only after a dependency is satisfied (e.g. a child dropdown enabled after
 * its parent is chosen) instead of sleeping.
 */
export async function waitForEnabled(
  locator: Locator,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout });
  const deadline = Date.now() + timeout;
  // Poll the enabled state; Playwright's expect could be used but this keeps zero test-dep.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await locator.isEnabled()) return;
    if (Date.now() > deadline) {
      throw new Error(`waitForEnabled: element still disabled after ${timeout}ms`);
    }
    await locator.page().waitForTimeout(100); // short internal poll, not a test-level sleep
  }
}

/**
 * Wait until ANY of the provided locators is visible, and return the first that appears.
 * Use for branchy outcomes — e.g. success banner OR validation error after a submit —
 * so a test reacts to whichever the app actually renders.
 */
export async function waitForVisibleAny(
  locators: Locator[],
  timeout: number = ACTION_TIMEOUT
): Promise<Locator> {
  const result = await Promise.race(
    locators.map(async (loc) => {
      await loc.waitFor({ state: 'visible', timeout });
      return loc;
    })
  );
  return result;
}

/**
 * Soft-wait that an element disappears (e.g. a closing listbox/overlay) without failing
 * the test if it was never there. Replaces `waitForTimeout` used to "let an overlay close".
 */
export async function waitForGone(
  locator: Locator,
  timeout: number = SETTLE_TIMEOUT
): Promise<void> {
  await locator.waitFor({ state: 'hidden', timeout }).catch(() => {});
}
