// Clicking the toolbar icon opens the extractor panel on the current tab.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["xlsx.js", "extractor.js"],
    });
  } catch (err) {
    // Typically: a chrome:// page or the Web Store, where extensions cannot run.
    const msg = "Siebel Table Extractor could not run on this tab.\n\n" +
      "Open the Siebel tab with the list and click the icon again.\n\n" +
      "Technical details: " + (err && err.message ? err.message : String(err));
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (m) => alert(m),
        args: [msg],
      });
    } catch (_) {
      console.error(msg);
    }
  }
});
