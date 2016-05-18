#!/usr/bin/env bash

echo $PATH
source /tmp/.nvm/nvm.sh
echo $PATH
nvm use default
node --version
npm --version
npm test
