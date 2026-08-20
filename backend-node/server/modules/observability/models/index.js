'use strict';

/**
 * Registers the observability models with mongoose.
 *
 * Called by the module manifest's `models` hook, before any route is mounted,
 * so `mongoose.model('ApplicationLog')` resolves anywhere in the process
 * afterwards.
 */

module.exports = function registerModels() {
  return {
    ApplicationLog: require('./application-log.model')
  };
};
