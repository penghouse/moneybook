-- Drops everything this app owns, so docs/schema.sql can be run against
-- a clean database. **This deletes all data.**
--
-- Children before parents: with foreign keys enforced, DROP TABLE does an
-- implicit DELETE FROM first, and dropping a parent while a child still
-- references it fails on the restrict/cascade rules.
--
-- Dropping auth_user signs everyone out and forgets which Google account
-- maps to which row. That is fine — signing in again recreates it — but
-- it also means a new user id, so anything keyed to the old one is gone
-- with the rest.

DROP TABLE IF EXISTS `transaction_lines`;
DROP TABLE IF EXISTS `budgets`;
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `accounts`;
DROP TABLE IF EXISTS `sections`;
DROP TABLE IF EXISTS `auth_session`;
DROP TABLE IF EXISTS `auth_account`;
DROP TABLE IF EXISTS `auth_verification_token`;
DROP TABLE IF EXISTS `auth_user`;
DROP TABLE IF EXISTS `exchange_rates`;
DROP TABLE IF EXISTS `__drizzle_migrations`;
