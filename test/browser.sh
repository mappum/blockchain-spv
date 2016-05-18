#!/bin/sh

npm run build
if [ $BROWSER ]; then
  zuul \
    --browser-name $BROWSER \
    --browser-version latest \
    -- test/*.js
else
  zuul --local -- test/*.js;
fi
npm run source
