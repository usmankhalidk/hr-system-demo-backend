#!/bin/sh
set -e

echo "=== HR System Backend ==="
echo "Running startup seed check..."
node dist/scripts/seed.js

echo "Starting server..."
exec node dist/index.js
