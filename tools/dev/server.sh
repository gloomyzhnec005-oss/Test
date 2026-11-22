#!/bin/sh
# Локальный сервер для проверок: порт 3123, пароль админки testpass, данные — в отдельной папке (не трогает рабочие).
# sh tools/dev/server.sh /tmp/mh-data   → http://localhost:3123  (гости разрешены: ?guestId в localStorage)
DIR=${1:-/tmp/mh-data}; mkdir -p "$DIR"
PORT=3123 ADMIN_PASSWORD=testpass DATA_DIR="$DIR" node server/index.js
