# GAS v51 integration

The production Apps Script source is not present in this repository. Add `AIBackend.gs` to script ID `1ZY764nl6sabP0Sbj4bOFklpBkSmoa767sSWbjEO4nxusezNE4nEMQT1L`, then:

1. Route `aiPlan`, `aiExecute`, `aiSessionEnd`, and `aiAuditSearch` through `dispatchAiV50_(body)` before the legacy `ai` route.
2. Connect `aiLoadStateV50_` and `aiSaveStateV50_` to the existing authoritative state functions.
3. Set script properties `GEMINI_KEY`, `SPREADSHEET_ID`, `ADMIN_NAME`, and optionally `GEMINI_MODEL` (`gemini-3.5-flash-lite` by default).
4. Redeploy the existing web-app deployment or create a replacement and update `DEFAULT_URL` in `index.html`.

For v51, the authoritative item storage must preserve `completionMode` and `doneBy`. Any `notifyfeed` or morning-reminder logic in the production script must use the requesting member's `doneBy[me]` state for `completionMode: "individual"` tasks instead of filtering only on the legacy top-level `done` value.

The old deployment currently returns HTTP 404. A deleted or invalid deployment cannot be repaired by changing the model name; it must be redeployed first.
