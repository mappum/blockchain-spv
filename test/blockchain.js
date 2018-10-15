'use strict'

const test = require('tape')
const Blockchain = require('../lib/blockchain.js')
const { mine, testGenesis } = require('./utils.js')

const bitcoinGenesis = {
  height: 0,
  version: 1,
  prevHash: Buffer.alloc(32),
  merkleRoot: Buffer.from('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', 'hex').reverse(),
  timestamp: 1231006505,
  bits: 0x1d00ffff,
  nonce: 2083236893
}
const bitcoinGenesisHash = '6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000'

test('create Blockchain instance', function (t) {
  t.test('with no args', function (t) {
    try {
      let chain = new Blockchain()
      t.undefined(chain)
    } catch (err) {
      t.equal(err.message, 'Must specify starting header')
    }
    t.end()
  })

  t.test('with non-empty store', function (t) {
    let store = [ bitcoinGenesis ]
    let chain = new Blockchain({ store })
    t.deepEquals(chain.getByHeight(0), bitcoinGenesis)
    t.end()
  })

  t.test('with starting header', function (t) {
    let chain = new Blockchain({ start: bitcoinGenesis })
    t.deepEquals(chain.getByHeight(0), bitcoinGenesis)
    t.end()
  })

  t.end()
})

test('getByHeight', function (t) {
  t.test('out of range', function (t) {
    let chain = new Blockchain({ start: bitcoinGenesis })
    try {
      chain.getByHeight(1)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Header not found')
    }
    try {
      chain.getByHeight(-1)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Header not found')
    }
    t.end()
  })

  t.test('in range', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    t.deepEquals(chain.getByHeight(0), testGenesis)
    t.equals(chain.getByHeight(10).height, 10)
    t.end()
  })

  t.test('with extra', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    let extra = mine(chain, 10, false)
    t.deepEquals(chain.getByHeight(0, extra), testGenesis)
    t.equals(chain.getByHeight(10, extra).height, 10)
    t.equals(chain.getByHeight(11, extra).height, 11)
    t.equals(chain.getByHeight(20, extra).height, 20)
    t.end()
  })

  t.end()
})

test('getByHash', function (t) {
  t.test('errors when not indexing', function (t) {
    let chain = new Blockchain({ start: bitcoinGenesis })
    try {
      chain.getByHash(bitcoinGenesisHash)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Indexing disabled, try instantiating with `indexed: true`')
    }
    t.end()
  })

  t.test('with string', function (t) {
    let chain = new Blockchain({ start: bitcoinGenesis, indexed: true })
    t.deepEquals(
      chain.getByHash(bitcoinGenesisHash),
      bitcoinGenesis
    )
    t.end()
  })

  t.test('with Buffer', function (t) {
    let chain = new Blockchain({ start: bitcoinGenesis, indexed: true })
    t.deepEquals(
      chain.getByHash(Buffer.from(bitcoinGenesisHash, 'hex')),
      bitcoinGenesis
    )
    t.end()
  })

  t.test('for missing header', function (t) {
    let chain = new Blockchain({ start: bitcoinGenesis, indexed: true })
    try {
      chain.getByHash('1234')
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Header not found')
    }
    t.end()
  })

  t.end()
})
