'use strict'

var test = require('tape')
var Blockchain = require('../lib/blockchain.js')

test('create Blockchain instance with no args', function (t) {
  try {
    let chain = new Blockchain()
    t.undefined(chain)
  } catch (err) {
    t.equal(err.message, 'Must specify starting header')
  }
  t.end()
})
