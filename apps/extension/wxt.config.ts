import { defineConfig } from "wxt";

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  // WXT defaults Firefox to MV2. We override to MV3 on BOTH browsers.
  //
  // Firefox's MV3 background is an *event page*, not a service worker, so it
  // keeps DOM and Web API access - which means no chrome.offscreen equivalent
  // is needed there. Chrome is the constrained runtime, not Firefox.
  // See BRIEF.md section 13.1.
  manifestVersion: 3,

  manifest: {
    // Set explicitly. Without this WXT derives it from package.json and the
    // extension shows up as "@skrim/extension" on chrome://extensions,
    // which a judge will see.
    name: "Private Browser Agent",
    description:
      "An agent that reads your screen and does tasks for you, while the server " +
      "doing the thinking never receives anything that identifies you.",

    // MINIMAL PERMISSIONS ARE A SCORED SIGNAL (brief section 7). A judge can
    // read this list in ten seconds. Every entry must be justifiable out loud.
    // Do not add one without saying why in the PR.
    permissions: [
      "activeTab", // read/act on the tab the user pointed us at
      "scripting", // inject the content script on demand
      "tabs", // captureVisibleTab for the vision pass
      "sidePanel", // the task UI
    ],

    // OPEN DECISION - workstream 1 owns this.
    //
    // There is no host_permissions entry, but entrypoints/content.ts currently
    // declares a static content script matching <all_urls>, and Chrome grants
    // host access from those matches regardless. So the install prompt today
    // still reads "read and change all your data on all websites".
    //
    // The stronger story is to drop the static match and inject on demand with
    // chrome.scripting + activeTab, which needs a user gesture per tab. That is
    // more work and changes how the loop starts, so it is a deliberate call
    // rather than a cleanup. Decide it before the demo - the permissions
    // screen is something a judge can see without being shown.
  },
});
