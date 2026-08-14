/**
 * Complete a successful name/device claim without leaving a broadcast logout
 * marker behind. The claims array remains additive, so signing in on a PC must
 * not remove an already registered iPhone (and vice versa).
 */
function identityCompleteClaimV63_(name) {
  var unlocks = metaGet_('unlocks', {}) || {};
  if (!/^logout:/.test(String(unlocks[name] || ''))) return false;
  delete unlocks[name];
  metaSet_('unlocks', unlocks);
  return true;
}
