/**
 * v65: shared APP_KEY replacement for normal synchronization.
 * A successful PIN-verified claim issues one opaque token per name/device pair.
 * Only a SHA-256 digest is stored server-side.
 */
var SYNC_TOKEN_META_V65_ = 'syncTokensV65';

function syncTokenHexV65_(bytes) {
  return (bytes || []).map(function (b) {
    var n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
}

function syncTokenHashV65_(token) {
  token = String(token || '');
  if (!token) return '';
  return syncTokenHexV65_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    token,
    Utilities.Charset.UTF_8
  ));
}

function syncTokenParamsV65_(e, body) {
  var p = e && e.parameter || {};
  body = body || {};
  return {
    name: canonicalIdentityV57_(body.me || body.name || p.me || p.name || ''),
    dev: String(body.dev || p.dev || ''),
    token: String(body.syncToken || p.syncToken || '')
  };
}

function syncTokenValidV65_(e, body) {
  var q = syncTokenParamsV65_(e, body);
  if (!q.name || !q.dev || !q.token) return false;
  var claims = metaGet_('claims', {}) || {};
  if (identityClaimDevsV57_(q.name, claims).indexOf(q.dev) < 0) return false;
  var all = metaGet_(SYNC_TOKEN_META_V65_, {}) || {};
  var byDevice = all[q.name];
  if (!byDevice || typeof byDevice !== 'object' || Array.isArray(byDevice)) return false;
  return String(byDevice[q.dev] || '') === syncTokenHashV65_(q.token);
}

function syncTokenIssueV65_(name, dev) {
  name = canonicalIdentityV57_(name);
  dev = String(dev || '');
  if (!name || !dev) return '';
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var all = metaGet_(SYNC_TOKEN_META_V65_, {}) || {};
  var byDevice = all[name];
  if (!byDevice || typeof byDevice !== 'object' || Array.isArray(byDevice)) byDevice = {};
  byDevice[dev] = syncTokenHashV65_(token);
  all[name] = byDevice;
  metaSet_(SYNC_TOKEN_META_V65_, all);
  return token;
}

function syncTokenRevokeIdentityV65_(name) {
  name = canonicalIdentityV57_(name);
  var all = metaGet_(SYNC_TOKEN_META_V65_, {}) || {};
  if (!name || !(name in all)) return false;
  delete all[name];
  metaSet_(SYNC_TOKEN_META_V65_, all);
  return true;
}
