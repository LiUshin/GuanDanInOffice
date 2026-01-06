#!/bin/bash
# GuanDan Game Server Startup Script

set -e

echo "🎴 Starting GuanDan Game Server..."

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if dist folder exists
if [ ! -d "dist" ]; then
    echo "📦 Building project..."
    npm run build
fi

# Check if pm2 is installed
if command -v pm2 &> /dev/null; then
    echo "🚀 Starting with PM2..."
    pm2 start dist/server/index.js --name guandan-game
    pm2 save
    echo "✅ Server started with PM2!"
    echo "📊 View logs: pm2 logs guandan-game"
    echo "📈 View status: pm2 status"
else
    echo "⚠️  PM2 not found. Starting in foreground mode..."
    echo "💡 Tip: Install PM2 for production: npm install -g pm2"
    node dist/server/index.js
fi
