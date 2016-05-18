#!/usr/bin/env bash

if [ -z $NODE ]; then
  export NODE=6
fi

git clone https://github.com/creationix/nvm.git /tmp/.nvm
source /tmp/.nvm/nvm.sh
nvm install $NODE
nvm use $NODE
nvm alias default $NODE
nvm --version
node --version
npm --version
npm install
echo $PATH
