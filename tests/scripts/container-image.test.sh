#!/usr/bin/env sh
set -eu

test -f Dockerfile
rg -q 'eclipse-temurin:21' Dockerfile
rg -q ':runtime:bootJar' Dockerfile
rg -q 'USER bidflow' Dockerfile
rg -q 'ENTRYPOINT' Dockerfile
