#!/bin/bash
echo "Stopping any running Firebase emulators..."
pkill -f "firebase.*emulators" || true
sleep 2
echo "Starting Firebase emulators..."
firebase emulators:start
