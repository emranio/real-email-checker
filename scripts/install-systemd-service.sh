#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="smtp-email-validator"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
RUN_USER="${SUDO_USER:-$(id -un)}"
RUN_GROUP="$(id -gn "$RUN_USER")"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Error: node binary not found in PATH." >&2
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "Error: $PROJECT_DIR/.env not found." >&2
  echo "Create it first (you can copy .env.example)." >&2
  exit 1
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=SMTP Email Validator Node.js Backend
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=15

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${PROJECT_DIR}/.env
ExecStart=${NODE_BIN} ${PROJECT_DIR}/src/backend/server.js
Restart=on-failure
RestartSec=5
User=${RUN_USER}
Group=${RUN_GROUP}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

echo "Installed and started ${SERVICE_NAME}.service"
echo "Check status: sudo systemctl status ${SERVICE_NAME}.service"
echo "Tail logs:    sudo journalctl -u ${SERVICE_NAME}.service -f"
