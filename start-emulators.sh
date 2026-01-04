#!/bin/bash

# Start Firebase Emulators
echo "🚀 Starting Firebase Emulators..."
echo ""

cd "$(dirname "$0")"

# Set JAVA_HOME to Java 21 (required for Firebase emulators)
if [ -d "/opt/homebrew/opt/openjdk@21" ]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@21
    export PATH="$JAVA_HOME/bin:$PATH"
    echo "✓ Using Java 21 from Homebrew"
    java -version 2>&1 | head -1
elif [ -d "/usr/local/opt/openjdk@21" ]; then
    export JAVA_HOME=/usr/local/opt/openjdk@21
    export PATH="$JAVA_HOME/bin:$PATH"
    echo "✓ Using Java 21 from Homebrew"
    java -version 2>&1 | head -1
else
    # Try to find Java 21 or higher using java_home
    JAVA_21_HOME=$(/usr/libexec/java_home -v 21+ 2>/dev/null)
    if [ -n "$JAVA_21_HOME" ]; then
        export JAVA_HOME="$JAVA_21_HOME"
        export PATH="$JAVA_HOME/bin:$PATH"
        echo "✓ Using Java from: $JAVA_HOME"
        java -version 2>&1 | head -1
    else
        echo "⚠️  Warning: Java 21+ not found. Emulators may fail to start."
        echo "   Install with: brew install openjdk@21"
    fi
fi

# Check if Firebase CLI is available
if ! command -v firebase &> /dev/null && ! command -v npx &> /dev/null; then
    echo "❌ Error: Firebase CLI not found. Installing via npx..."
    npm install -g firebase-tools || {
        echo "Using npx to run firebase-tools..."
        npx firebase-tools emulators:start
        exit
    }
fi

# Start emulators
if command -v firebase &> /dev/null; then
    firebase emulators:start
else
    npx firebase-tools emulators:start
fi


