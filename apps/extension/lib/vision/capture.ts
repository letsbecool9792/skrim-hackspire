/*/// <reference types="chrome" />

export async function captureVisibleTab(): Promise<string> {
  return await chrome.tabs.captureVisibleTab({
    format: "png",
  });
}*/

/// <reference types="chrome" />

export async function captureVisibleTab(): Promise<string> {
  const windows = await chrome.windows.getAll({
    populate: true,
  });

  const browserWindow = windows.find(
    (window) =>
      window.type === "normal" &&
      window.tabs?.some((tab) => tab.active),
  );

  if (!browserWindow?.id) {
    throw new Error("No normal browser window with an active tab found");
  }

  return await chrome.tabs.captureVisibleTab(browserWindow.id, {
    format: "png",
  });
}