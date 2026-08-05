// Pluggable fill engines under test, each: (form) -> [{id, caption, value, option?}].
// Side-effect free so runners/dumpers can import without triggering a benchmark.
import { planProximityFill } from "../../apps/extension/src/pdfproximity.js";
import { resolveFields } from "../../apps/extension/src/resolver.js";
import { VAULT } from "./score.mjs";

// CURRENT: the shipped shared proximity planner over the pdf.js widget layer.
export function currentEngine(form) {
  return planProximityFill(form.fields, form.texts, VAULT, resolveFields).assignments;
}
