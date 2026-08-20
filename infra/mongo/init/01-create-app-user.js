/* eslint-disable no-undef */
/**
 * Runs once, on first initialisation of the mongo data volume.
 *
 * Creates a least-privilege application user scoped to the application
 * database only. The root user exists for operations and must never appear
 * in an application connection string.
 */
(function createApplicationUser() {
  const dbName = process.env.MONGO_INITDB_DATABASE || 'app';
  const appUser = process.env.MONGO_APP_USERNAME;
  const appPassword = process.env.MONGO_APP_PASSWORD;

  if (!appUser || !appPassword) {
    print('[mongo-init] MONGO_APP_USERNAME/MONGO_APP_PASSWORD not set - skipping app user creation.');
    return;
  }

  const appDb = db.getSiblingDB(dbName);

  const existing = appDb.getUser(appUser);
  if (existing) {
    print('[mongo-init] Application user already exists: ' + appUser);
    return;
  }

  appDb.createUser({
    user: appUser,
    pwd: appPassword,
    roles: [{ role: 'readWrite', db: dbName }]
  });

  print('[mongo-init] Created application user "' + appUser + '" on database "' + dbName + '".');
})();
