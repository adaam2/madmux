#!/bin/bash
# Example post-open script for madagents worktrees
# Configure this per-worktree via the Config button, or set as default in ~/.config/madagents/config.json

# Load nvm if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use project node version
nvm use 2>/dev/null

# Install deps if needed
if [ ! -d "node_modules" ]; then
  npm install
fi

echo "Worktree ready: $(git branch --show-current)"
