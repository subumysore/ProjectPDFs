// Renders the just-filled PDF (passed from the popup via session storage) so the user
// SEES the result — the browser can't edit the original PDF viewer in place.
chrome.storage.session.get("ppf_filled").then(({ ppf_filled }) => {
  if (!ppf_filled) {
    document.getElementById("f").hidden = true;
    document.getElementById("empty").hidden = false;
    return;
  }
  const bin = atob(ppf_filled);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
  document.getElementById("f").src = url;
  document.getElementById("dl").href = url;
  chrome.storage.session.remove("ppf_filled");
});
