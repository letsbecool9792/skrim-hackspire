import { defineConfig } from "wxt";

// Where the planning server runs, baked in at build time. To point a build
// elsewhere:
//   $env:SKRIM_SERVER_URL = "https://planner.example"; pnpm --filter @skrim/extension build
const SERVER_URL = (process.env.SKRIM_SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  vite: () => ({
    define: { "import.meta.env.WXT_SKRIM_SERVER_URL": JSON.stringify(SERVER_URL) },
  }),

  // WXT defaults Firefox to MV2. We override to MV3 on BOTH browsers.
  //
  // Firefox's MV3 background is an *event page*, not a service worker, so it
  // keeps DOM and Web API access - which means no chrome.offscreen equivalent
  // is needed there. Chrome is the constrained runtime, not Firefox.
  // See BRIEF.md section 13.1.
  manifestVersion: 3,

  // A function, not an object, so permissions can differ per browser.
  manifest: ({ browser }) => ({
    // Set explicitly. Without this WXT derives it from package.json and the
    // extension shows up as "@skrim/extension" on chrome://extensions,
    // which a judge will see.
    name: "Skrim",
    description:
      "An agent that reads your screen and does tasks for you, while the server " +
      "doing the thinking never receives anything that identifies you.",

    // The toolbar button opens the side panel (entrypoints/background). Set
    // here because without a popup WXT would leave the key out.
    action: { default_title: "Open Skrim" },

    // MINIMAL PERMISSIONS ARE A SCORED SIGNAL (brief section 7). A judge can
    // read this list in ten seconds. Every entry must be justifiable out loud.
    // Do not add one without saying why in the PR.
    //
    // Not here: "tabs". It only unlocks tab URLs and titles, which nothing
    // reads (the content script reports its own page), and it shows users a
    // "Read your browsing history" warning. WXT adds "sidePanel" on Chrome,
    // for the side panel the agent runs in; it has no install warning.
    permissions: [
      // Starts the content script in tabs that were already open when Skrim
      // was installed or reloaded, instead of asking the user to reload the
      // page. No install warning of its own.
      "scripting",
      // Model inference on Chrome needs an offscreen document, because WebGPU
      // and WASM are unavailable in its service worker. Chrome only: Firefox
      // has no offscreen API (its event page keeps DOM access) and reports the
      // permission as invalid.
      ...(browser === "chrome" ? ["offscreen"] : []),
    ],

    // Every site. The <all_urls> content script already gives Skrim this
    // reach, and the same "read and change all your data on all websites"
    // install warning, but only as host permission does it cover
    // captureVisibleTab (OCR), injecting the content script, and the planning
    // server. It replaces "activeTab", which the side panel never gets:
    // capture failed with "click the icon again" on every page.
    host_permissions: ["<all_urls>"],

    // Every on-device model (Tesseract, and later GLiNER, BlazeFace and the
    // icon detector) is WebAssembly. The default MV3 policy is
    // "script-src 'self'", which blocks compiling it, and Tesseract then hung
    // without an error. 'wasm-unsafe-eval' allows WebAssembly only; it does
    // not allow eval() or remote code.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },

    browser_specific_settings: {
      gecko: {
        id: "skrim@tropical-crush",
        strict_min_version: "128.0",
        // Required of new Firefox add-ons since 3 Nov 2025. The planning
        // server receives the page's structure and text, with personal data
        // replaced by tokens. That is still website content leaving the
        // device, so "none" would overclaim.
        data_collection_permissions: { required: ["websiteContent"] },
      },
    },
  }),
});
