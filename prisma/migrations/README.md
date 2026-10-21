# Migration policy

`20261016110000_init/migration.sql` is generated from the validated Prisma schema without a database connection. `20261017120000_add_express_session/migration.sql` adds the persistent Express session table used by cookie-based auth. Review migrations before applying. `npm run db:migrate` is for a dedicated local HUKMEE database; `npm run db:deploy` is for a controlled deployment pipeline. Do not point either command at another project's or production database without the relevant deployment authorization. No migration has been applied by this project setup.
