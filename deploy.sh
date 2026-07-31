#!/usr/bin/env bash
# Deploying the admin panel is now part of the single combined deploy
# script that also handles backend-service and python-services, since all
# three run together on the same droplet from one shared .env — see
# trabelci-api-main/deploy.sh and trabelci-api-main/docs/PYTHON_SERVICES_SPLIT.md.
#
# This file is intentionally just a pointer: run that one instead.
echo "Run trabelci-api-main/deploy.sh on the droplet — it deploys admin-panel, backend-service, and python-services together."
exit 1
