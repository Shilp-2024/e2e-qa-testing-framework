/**
 * Shared mobile timeout constants — generic, project-agnostic.
 * Mirrors shared/utils/timeouts.ts. Override per project via .env.
 */

export const ACTION_TIMEOUT = Number(process.env.ACTION_TIMEOUT) || 90000;

/** Appium session idle timeout before it's torn down server-side. */
export const APPIUM_NEW_COMMAND_TIMEOUT = Number(process.env.APPIUM_NEW_COMMAND_TIMEOUT) || 120000;

/** Short timeout for "settle" / soft-wait probes that are expected to resolve quickly. */
export const SETTLE_TIMEOUT = Number(process.env.SETTLE_TIMEOUT) || 5000;
