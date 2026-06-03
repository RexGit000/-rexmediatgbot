const addAdminScene    = require('./addAdmin');
const removeAdminScene = require('./removeAdmin');
const setChannelScene  = require('./setChannel');
const broadcastScene   = require('./broadcast');
const editPackageScene = require('./editPackage');
const giftMediaScene   = require('./giftMedia');

module.exports = [
  addAdminScene,
  removeAdminScene,
  setChannelScene,
  broadcastScene,
  editPackageScene,
  giftMediaScene,
];
