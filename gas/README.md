# GAS v63 integration

The production Apps Script source is not present in this repository. Add both `AIBackend.gs` and `MergeSecurity.gs` to script ID `1ZY764nl6sabP0Sbj4bOFklpBkSmoa767sSWbjEO4nxusezNE4nEMQT1L`, then:

1. Route `aiPlan`, `aiExecute`, `aiSessionEnd`, and `aiAuditSearch` through `dispatchAiV50_(body)` before the legacy `ai` route.
2. Connect `aiLoadStateV50_` and `aiSaveStateV50_` to the existing authoritative state functions.
3. In the existing `merge` route, verify the name/device claim and admin secret first, then pass the incoming delta through `secureChangedV54_(body.changed, state, {me: verifiedName, isAdmin: verifiedAdmin})` before the LWW merge. Never trust `body.me` or `body.admin` without those server checks.
4. Set script properties `GEMINI_KEY`, `SPREADSHEET_ID`, `ADMIN_NAME`, and optionally `GEMINI_MODEL` (`gemini-3.5-flash-lite` by default). Set `GEMINI_DATA_MODE=paid` only after confirming the project uses a paid Gemini API or an eligible Google Workspace service with the required data protections. If it is absent, AI external transmission intentionally fails closed.
5. Add `MultiDeviceIdentity.gs`. In the existing `claim` route, call `identityCompleteClaimV63_(name)` immediately after saving the updated `claims` map. This removes only a stale `logout:` marker after a successful PIN-verified claim; it must not replace or remove any device IDs in `claims[name]`.
6. Redeploy the existing web-app deployment or create a replacement and update `DEFAULT_URL` in `index.html`.

The authoritative item storage must preserve `completionMode`, `doneBy`, `createdBy`, and `comments`. Any `notifyfeed` or morning-reminder logic must use the requesting member's `doneBy[me]` state for `completionMode: "individual"` tasks instead of filtering only on the legacy top-level `done` value.

The repository's last recorded production check found the old deployment returning HTTP 404. A deleted, stale, or invalid deployment cannot be repaired by changing the model name; it must be redeployed and its `/exec` URL verified.
