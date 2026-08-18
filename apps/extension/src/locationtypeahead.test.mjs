// "Current location" / "Start typing…" boxes are type-aheads that only accept a suggestion they
// offered: setting the value leaves the form holding nothing (Ashby) or is wiped outright (Lever).
// So we type it like a person, wait for the menu, and pick the suggestion that matches where the user
// actually lives — and when the menu is ambiguous or empty we do NOT guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fillPage } from "./pagefill.js";

function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element", "getComputedStyle", "CSS"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  return dom;
}

// A place box that reveals its menu once something is typed, and commits on the row's click.
function placeBox(suggestions) {
  return `<div class="field"><label for="loc">Current location</label>
    <input id="loc" role="combobox" placeholder="Start typing..." class="location-input">
    <div id="menu" class="suggestions"></div></div>
    <script></script>`;
}
function wire(dom, suggestions) {
  const d = dom.window.document;
  const input = d.getElementById("loc");
  const menu = d.getElementById("menu");
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    menu.innerHTML = "";
    if (!q) return;
    for (const s of suggestions.filter((x) => x.toLowerCase().includes(q))) {
      const row = d.createElement("div");
      row.setAttribute("role", "option");
      row.textContent = s;
      row.addEventListener("click", () => { input.value = s; menu.innerHTML = ""; });
      menu.appendChild(row);
    }
  });
  return input;
}
const VAULT = { first_name: "Asha", last_name: "Rao", city: "Raleigh", state: "North Carolina", country: "United States" };

test("a location type-ahead is typed, and the suggestion for the user's own state is chosen", async () => {
  const dom = mount(placeBox());
  const input = wire(dom, ["Raleigh, North Carolina, United States", "Raleigh, Mississippi, United States", "Raleigh, New South Wales, Australia"]);
  await fillPage(VAULT);
  assert.equal(input.value, "Raleigh, North Carolina, United States");
});

test("a single unambiguous suggestion is accepted", async () => {
  const dom = mount(placeBox());
  const input = wire(dom, ["Raleigh, NC"]);
  await fillPage({ ...VAULT, state: "" });
  assert.equal(input.value, "Raleigh, NC");
});

test("when several towns share the name and none is the user's state, nothing is chosen for them", async () => {
  const dom = mount(placeBox());
  const input = wire(dom, ["Raleigh, Mississippi, United States", "Raleigh, Illinois, United States"]);
  await fillPage({ ...VAULT, state: "North Carolina" });
  assert.ok(!/Mississippi|Illinois/.test(input.value), `picked "${input.value}" for the wrong state`);
});

test("an explicit stored location wins over the composed one", async () => {
  const dom = mount(placeBox());
  const input = wire(dom, ["Durham, North Carolina, United States", "Raleigh, North Carolina, United States"]);
  await fillPage({ ...VAULT, current_location: "Durham, North Carolina", city: "Durham" });
  assert.equal(input.value, "Durham, North Carolina, United States");
});

test("a location box the user has already answered is left alone", async () => {
  const dom = mount(placeBox());
  const input = wire(dom, ["Raleigh, North Carolina, United States"]);
  input.value = "Chapel Hill, North Carolina";
  await fillPage(VAULT);
  assert.equal(input.value, "Chapel Hill, North Carolina");
});
