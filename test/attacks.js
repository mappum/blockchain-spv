'use strict'

const test = require('tape')
const Blockchain = require('../src/blockchain.js')
const {
  mine,
  testGenesis,
  testMaxTarget
} = require('./utils.js')

test('fork selection', (t) => {
  t.test('reject reorg with equal work/height', (t) => {
    let chain = new Blockchain({
      start: testGenesis
    })
    let headers = mine(chain, 100, false)
    mine(chain, 100)
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.pass()
    }
    t.end()
  })

  // TODO: this should pass once we pick chains based on work instead of height
  t.skip('reject reorg with lower work and higher height', (t) => {
    let chain = new Blockchain({
      start: testGenesis,
      maxTarget: testMaxTarget
    })

    mine(chain, 2015)
    let headers = mine(chain, 3, false, 100000)
    mine(chain, 2, 1)
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.pass()
    }
    t.end()
  })

  t.test('reject headers with missing fields', (t) => {
    t.test('height', (t) => {
      let chain = new Blockchain({ start: testGenesis })
      let headers = mine(chain, 1, false)
      delete headers[0].height
      try {
        chain.add(headers)
        t.fail()
      } catch (err) {
        t.pass()
      }
      t.end()
    })

    t.test('height', (t) => {
      let chain = new Blockchain({ start: testGenesis })
      let headers = mine(chain, 1, false)
      delete headers[0].timestamp
      try {
        chain.add(headers)
        t.fail()
      } catch (err) {
        t.pass()
      }
      t.end()
    })

    t.end()
  })

  t.test('reject timestretched headers', (t) => {
    let chain = new Blockchain({
      start: testGenesis,
      maxTarget: testMaxTarget
    })
    mine(chain, 2015)
    let headers = mine(chain, 2, false)
    headers[0].timestamp += 1e6
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.pass(err.message)
    }

    t.end()
  })

  t.test('reject fake reorg (same fork)', (t) => {
    let chain = new Blockchain({ start: testGenesis })
    let headers = mine(chain, 10)
    let headers2 = mine(chain, 10, false)
    try {
      chain.add(headers.concat(headers2))
      t.fail()
    } catch (err) {
      t.pass(err.message)
    }

    t.end()
  })

  t.end()
})
