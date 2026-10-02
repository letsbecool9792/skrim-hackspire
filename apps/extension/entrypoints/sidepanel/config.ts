/**
 * Where the planning server runs. Set at build time from SKRIM_SERVER_URL
 * (see wxt.config.ts, which also grants the host permission for it).
 */
export const SERVER_URL: string = import.meta.env.WXT_SKRIM_SERVER_URL;
