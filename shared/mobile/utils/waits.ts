/**
 * Deterministic wait helpers for Appium/WebdriverIO — generic, project-agnostic.
 * Mirrors shared/utils/waits.ts. WebdriverIO elements already expose
 * waitForDisplayed()/waitForEnabled(); these wrappers add project-default
 * timeouts and the concepts that don't exist natively (stability, "any of").
 */

import type { Browser as WdioBrowser, Element as WdioElement } from 'webdriverio';
import { ACTION_TIMEOUT, SETTLE_TIMEOUT } from './timeouts';

/**
 * Wait until an element has stopped moving (its location/size is stable across
 * three consecutive polls). Use after opening a screen transition/animation
 * instead of a fixed sleep.
 */
export async function waitForStable(
  driver: WdioBrowser,
  el: WdioElement,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await el.waitForDisplayed({ timeout });
  let lastLocation = await el.getLocation();
  let lastSize = await el.getSize();
  let stablePolls = 0;
  const deadline = Date.now() + timeout;

  while (stablePolls < 3) {
    await driver.pause(100);
    const location = await el.getLocation();
    const size = await el.getSize();
    const same =
      location.x === lastLocation.x &&
      location.y === lastLocation.y &&
      size.width === lastSize.width &&
      size.height === lastSize.height;
    stablePolls = same ? stablePolls + 1 : 0;
    lastLocation = location;
    lastSize = size;
    if (Date.now() > deadline) {
      throw new Error(`waitForStable: element still moving after ${timeout}ms`);
    }
  }
}

/** Wait until a control is displayed AND enabled (e.g. a field unlocked by a prior step). */
export async function waitForEnabled(
  el: WdioElement,
  timeout: number = ACTION_TIMEOUT
): Promise<void> {
  await el.waitForDisplayed({ timeout });
  await el.waitForEnabled({ timeout });
}

/**
 * Wait until ANY of the given selectors is displayed, and return the first element
 * that appears. Use for branchy outcomes (e.g. success screen OR validation error).
 */
export async function waitForDisplayedAny(
  driver: WdioBrowser,
  selectors: string[],
  timeout: number = ACTION_TIMEOUT
): Promise<WdioElement> {
  return Promise.race(
    selectors.map(async (selector) => {
      const el = driver.$(selector);
      await el.waitForDisplayed({ timeout });
      return el.getElement();
    })
  );
}

/** Soft-wait that an element disappears, without failing the test if it was never there. */
export async function waitForGone(
  el: WdioElement,
  timeout: number = SETTLE_TIMEOUT
): Promise<void> {
  await el.waitForDisplayed({ timeout, reverse: true }).catch(() => {});
}
