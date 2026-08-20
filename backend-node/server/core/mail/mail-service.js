'use strict';

/**
 * Outbound email.
 *
 * `nodemailer` was already a dependency and six `notification.mail.*` settings
 * were already on the settings screen - host, port, username, password, from
 * address and a master switch - and nothing read any of them. Turning "Send
 * email notifications" on did nothing, and there was no way to find that out
 * except by reading the code.
 *
 * Three rules shape this file:
 *
 *   1. **Settings decide, not the environment.** The `SMTP_*` variables remain
 *      as the values a fresh deployment starts from; once an administrator
 *      saves the settings, those win. Otherwise the screen lies again.
 *   2. **Sending never breaks the thing it describes.** A password was still
 *      reset even if the mail server is down, so `send` resolves either way and
 *      reports the failure to the log rather than throwing into a controller.
 *   3. **The password is read one key at a time.** It is a `secret: true`
 *      setting, so it is absent from the bulk read on purpose - `get` is the
 *      deliberate path, and this is the code with a reason to take it.
 */

const nodemailer = require('nodemailer');

const config = require('../../../config');
const settingsService = require('../settings/settings-service');
const logger = require('../../../config/logger').forModule('mail');

/**
 * The built transport, with the configuration it was built from.
 *
 * Rebuilt when any of those values change, so editing SMTP settings takes
 * effect on the next message rather than the next deploy. Comparing a
 * signature is cheaper than tearing down a connection pool per send.
 */
let cached = { signature: null, transport: null };

async function resolveConfig() {
  const [enabled, host, port, username, password, from] = await Promise.all([
    settingsService.getOr('notification.mail.enabled', false),
    settingsService.getOr('notification.mail.host', config.mail.host),
    settingsService.getOr('notification.mail.port', config.mail.port),
    settingsService.getOr('notification.mail.username', config.mail.user),
    settingsService.getOr('notification.mail.password', config.mail.password),
    settingsService.getOr('notification.mail.from', config.mail.from)
  ]);

  return {
    enabled: Boolean(enabled),
    host: String(host || ''),
    port: Number(port) || 587,
    username: String(username || ''),
    password: String(password || ''),
    from: String(from || '')
  };
}

function buildTransport(settings) {
  const signature = JSON.stringify([settings.host, settings.port, settings.username, settings.password]);
  if (cached.signature === signature && cached.transport) return cached.transport;

  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is implicit TLS; everything else negotiates STARTTLS. Deriving it
    // from the port avoids a seventh setting that is wrong whenever the port
    // is changed without it.
    secure: settings.port === 465,
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined
  });

  cached = { signature, transport };
  return transport;
}

/** Whether mail is switched on AND has enough configuration to send. */
async function isEnabled() {
  const settings = await resolveConfig();
  return settings.enabled && Boolean(settings.host && settings.from);
}

/**
 * Sends a message. Resolves whether or not it was delivered.
 *
 * @param {object} message
 * @param {string} message.to
 * @param {string} message.subject
 * @param {string} message.text        Plain text. Deliberately the only body
 *                                     format: an HTML template layer is a
 *                                     project's own decision, and a security
 *                                     notice reads perfectly well without one.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function send({ to, subject, text }) {
  if (!to) return { sent: false, reason: 'NO_RECIPIENT' };

  const settings = await resolveConfig();

  if (!settings.enabled) return { sent: false, reason: 'DISABLED' };
  if (!settings.host || !settings.from) {
    logger.warn({ to, subject }, 'Mail is enabled but no host or from address is configured');
    return { sent: false, reason: 'NOT_CONFIGURED' };
  }

  try {
    await buildTransport(settings).sendMail({ from: settings.from, to, subject, text });
    logger.info({ to, subject }, 'Mail sent');
    return { sent: true };
  } catch (error) {
    // Never rethrown. The caller has already done the thing this message was
    // about; failing their request now would undo nothing and help nobody.
    logger.error({ err: error, to, subject }, 'Mail delivery failed');
    return { sent: false, reason: 'SEND_FAILED' };
  }
}

/**
 * Opens a connection and authenticates without sending anything, so an
 * administrator can find out whether the settings are right at the moment they
 * save them rather than the next time something tries to notify someone.
 */
async function verify() {
  const settings = await resolveConfig();

  if (!settings.enabled) return { ok: false, reason: 'Mail notifications are switched off.' };
  if (!settings.host) return { ok: false, reason: 'No SMTP host is configured.' };
  if (!settings.from) return { ok: false, reason: 'No from address is configured.' };

  try {
    await buildTransport(settings).verify();
    return { ok: true, reason: `Connected to ${settings.host}:${settings.port}.` };
  } catch (error) {
    logger.warn({ err: error, host: settings.host }, 'SMTP verification failed');
    return { ok: false, reason: error.message };
  }
}

/** Drops the cached transport. Called when the mail settings are written. */
function reset() {
  if (cached.transport && typeof cached.transport.close === 'function') cached.transport.close();
  cached = { signature: null, transport: null };
}

module.exports = { send, verify, isEnabled, reset };
