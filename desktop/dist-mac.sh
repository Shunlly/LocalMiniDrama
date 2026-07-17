#!/usr/bin/env bash

builtin printf '%s\n' 'ERROR: macOS release packaging is disabled (fail-closed).' >&2
builtin printf '%s\n' 'Missing release gates:' >&2
builtin printf '%s\n' '  - trusted FFmpeg SHA-256 digests for darwin-x64 and darwin-arm64' >&2
builtin printf '%s\n' '  - a macOS packaged-application smoke test' >&2
builtin printf '%s\n' '  - independent verification of macOS artifacts before upload' >&2
builtin printf '%s\n' 'No build or upload commands were executed.' >&2
builtin exit 1
