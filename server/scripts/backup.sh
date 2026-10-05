#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/phoenix"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET_FILE="$BACKUP_DIR/phoenix_backup_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "Backing up Phoenix database and configurations..."
# Backup SQLite db and config sans private keys
tar -czf "$TARGET_FILE" \
  /opt/phoenix/server/data/phoenix.db \
  /opt/phoenix/server/.env

chmod 600 "$TARGET_FILE"
echo "Backup created successfully at: $TARGET_FILE"
