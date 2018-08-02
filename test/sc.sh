#!/bin/bash

wget https://saucelabs.com/downloads/sc-4.4.12-linux.tar.gz
tar -xvf sc-4.4.12-linux.tar.gz
./sc-4.4.12-linux/bin/sc \
  --tunnel-domains=airtap.local \
  > sauce.log &
tail -f sauce.log | grep -m 1 "Sauce Connect is up, you may start your tests." | head -n 1
