#!/bin/sh

if [ $BROWSER ]; then
  zuul \
    --browser-name $BROWSER \
    --browser-version latest \
    --ui tape \
    -- test/*.js
else
  zuul --local --ui tape -- test/*.js
fi
