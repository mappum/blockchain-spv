#!/bin/bash

if [ -z $NODE ]; then
  NODE=6
fi
rm -rf ~/.nvm
git clone https://github.com/creationix/nvm.git ~/.nvm
source ~/.nvm/nvm.sh
nvm install $NODE
nvm --version
node --version
npm --version
npm install
