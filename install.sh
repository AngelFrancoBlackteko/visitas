#!/usr/bin/env bash
#
# install.sh — first-run installer for visitas.world.
#
# Creates a dedicated `visitas` system account on the host (no login shell)
# at the same UID/GID the image uses (10001), chowns ./data/ to it, ensures
# JWT_SECRET is set, and brings the stack up. Idempotent — safe to re-run.
#
# Usage:   sudo ./install.sh
#

set -euo pipefail

SERVICE_USER="visitas"
SERVICE_UID=10001
SERVICE_GID=10001

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

err() { printf '%s\n' "$*" >&2; }

if [[ "${EUID}" -ne 0 ]]; then
  err "install.sh needs root to create the service account and chown ./data/."
  err "Re-run with:  sudo ./install.sh"
  exit 1
fi

OPERATOR="${SUDO_USER:-}"
if [[ -z "$OPERATOR" || "$OPERATOR" == "root" ]]; then
  err "Refusing to install: run via 'sudo ./install.sh' as a normal user, not as root directly."
  err "docker compose will run as the invoking user so .env stays readable to them."
  exit 1
fi

if [[ "$OPERATOR" == "$SERVICE_USER" ]]; then
  err "Refusing to install: the invoking user must not be '$SERVICE_USER'."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed. Install Docker Engine + the compose plugin first."
  exit 1
fi

if ! id -nG "$OPERATOR" | tr ' ' '\n' | grep -qx docker; then
  err "User '$OPERATOR' is not in the 'docker' group. Add them with:"
  err "    sudo usermod -aG docker $OPERATOR"
  err "Then log out, log back in, and re-run this script."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Service account at UID/GID 10001 (matching the image)
# ---------------------------------------------------------------------------

NEED_NUMERIC_OVERRIDE=0
ACTUAL_UID="$SERVICE_UID"
ACTUAL_GID="$SERVICE_GID"

if id -u "$SERVICE_USER" >/dev/null 2>&1; then
  ACTUAL_UID="$(id -u "$SERVICE_USER")"
  ACTUAL_GID="$(id -g "$SERVICE_USER")"
  printf "User '%s' already exists (uid=%s gid=%s) — reusing.\n" \
    "$SERVICE_USER" "$ACTUAL_UID" "$ACTUAL_GID"
  if [[ "$ACTUAL_UID" -ne "$SERVICE_UID" || "$ACTUAL_GID" -ne "$SERVICE_GID" ]]; then
    NEED_NUMERIC_OVERRIDE=1
    printf "Existing UID/GID differs from image default (%s:%s); .env will override.\n" \
      "$SERVICE_UID" "$SERVICE_GID"
  fi
else
  conflict_user="$(getent passwd "$SERVICE_UID" | cut -d: -f1 || true)"
  conflict_group="$(getent group "$SERVICE_GID" | cut -d: -f1 || true)"
  if [[ -n "$conflict_user" || -n "$conflict_group" ]]; then
    err "Cannot create '$SERVICE_USER' at uid=$SERVICE_UID gid=$SERVICE_GID:"
    [[ -n "$conflict_user"  ]] && err "  uid $SERVICE_UID is already used by '$conflict_user'."
    [[ -n "$conflict_group" ]] && err "  gid $SERVICE_GID is already used by group '$conflict_group'."
    err "Free that UID/GID, or create the '$SERVICE_USER' user yourself and re-run this script."
    exit 1
  fi
  printf "Creating system user '%s' (uid=%s gid=%s, no login shell).\n" \
    "$SERVICE_USER" "$SERVICE_UID" "$SERVICE_GID"
  groupadd --system --gid "$SERVICE_GID" "$SERVICE_USER"
  useradd  --system --uid "$SERVICE_UID" --gid "$SERVICE_GID" \
           --shell /usr/sbin/nologin --no-create-home "$SERVICE_USER"
fi

# ---------------------------------------------------------------------------
# 2. .env — copy from template, ensure JWT_SECRET, write numeric override if needed
# ---------------------------------------------------------------------------

if [[ ! -f .env ]]; then
  cp .env.example .env
  printf "Created .env from .env.example.\n"
fi

upsert_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

current_jwt="$(grep '^JWT_SECRET=' .env | cut -d= -f2- || true)"
if [[ -z "$current_jwt" || "$current_jwt" == *change* || ${#current_jwt} -lt 32 ]]; then
  printf "Generating JWT_SECRET (64 random bytes hex).\n"
  upsert_env JWT_SECRET "$(openssl rand -hex 64)"
fi

if [[ "$NEED_NUMERIC_OVERRIDE" -eq 1 ]]; then
  upsert_env VISITAS_UID "$ACTUAL_UID"
  upsert_env VISITAS_GID "$ACTUAL_GID"
fi

# .env holds JWT_SECRET / AD bind password / SMTP creds. Keep it readable
# only by the operator who runs docker compose.
chown "$OPERATOR:$OPERATOR" .env
chmod 600 .env

# ---------------------------------------------------------------------------
# 3. Data directory
# ---------------------------------------------------------------------------

mkdir -p data
chown -R "$ACTUAL_UID:$ACTUAL_GID" data
chmod 750 data

# ---------------------------------------------------------------------------
# 4. Bring the stack up as the operator (who is in the docker group)
# ---------------------------------------------------------------------------

printf "\nBuilding image and starting visitas as %s...\n" "$OPERATOR"
sudo -u "$OPERATOR" docker compose up -d --build

printf "\nStatus:\n"
sudo -u "$OPERATOR" docker compose ps

host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -z "$host_ip" ]] && host_ip="<this-host>"
printf "\nDone. Admin UI:  http://%s:3000   (admin / admin — forced change on first login)\n" "$host_ip"
