/// <reference types="chrome" />

export async function captureVisibleTab(): Promise<string> {
  return await chrome.tabs.captureVisibleTab({
    format: "png",
  });
}