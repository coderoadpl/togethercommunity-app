#!/bin/sh
set -eu

node adapters/db/migrate.js
exec node apps/server/src/entry.node.js

