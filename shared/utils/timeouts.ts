/**
 * Shared timeout constants — generic, project-agnostic.
 * Single source of truth so generated code never hardcodes literal millisecond values.
 * Override per project via .env (ACTION_TIMEOUT / NAV_TIMEOUT in milliseconds).
 */

export const ACTION_TIMEOUT = Number(process.env.ACTION_TIMEOUT) || 90000;
export const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT) || 90000;

/** Short timeout for "settle" / soft-wait probes that are expected to resolve quickly. */
export const SETTLE_TIMEOUT = Number(process.env.SETTLE_TIMEOUT) || 5000;
