// @ts-nocheck
// The SAME option-matching engine the extension uses. Re-exported rather than ported: a dropdown,
// radio group or checkbox must behave identically in the browser and in the app.
//
// This file exists because the desktop had no equivalent at all — `fillAndExport` only ever touched
// PDFTextField, so on a real government form (which is mostly radio groups and tick boxes) the app
// left every one of them blank while the extension filled them.
export * from "@engine/optmatch.js";
