#!/bin/bash
# Dispara a sequência diária D1–D7 chamando o endpoint já implementado.
# Usado pelo Render Cron Job (rodar 1x por dia).
# Requer a env var SCHEDULER_SECRET configurada no ambiente do Cron Job.
set -euo pipefail

curl -s -X POST https://plataforma-espiritual.onrender.com/api/scheduler/run \
  -H "x-scheduler-key: $SCHEDULER_SECRET"
