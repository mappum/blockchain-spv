'use strict'

const test = require('tape')
const Blockchain = require('../lib/blockchain.js')
const {
  mine,
  createHeader,
  testGenesis,
  testMaxTarget
} = require('./utils.js')

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
    t.equals(chain.getByHeight(11, extra), extra[0])
    t.equals(chain.getByHeight(20, extra), extra[9])
    t.end()
  })

  t.test('with forked extra', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    let extra = mine(chain, 10, false)
    mine(chain, 20)
    t.deepEquals(chain.getByHeight(0, extra), testGenesis)
    t.equals(chain.getByHeight(10, extra).height, 10)
    t.equals(chain.getByHeight(11, extra), extra[0])
    t.equals(chain.getByHeight(20, extra), extra[9])
    try {
      chain.getByHeight(21, extra)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Header not found')
    }
    t.equals(chain.getByHeight(21).height, 21)
    t.notEqual(chain.getByHeight(20), extra[9])
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

test('add', function (t) {
  t.test('with non-array', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    try {
      chain.add(123)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Argument must be an array of block headers')
    }
    try {
      chain.add({})
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Argument must be an array of block headers')
    }
    t.end()
  })

  t.test('with disconnected first header', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    try {
      let headers = mine(chain, 10, false)
      chain.add(headers.slice(1))
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Start of headers is ahead of chain tip')
    }
    t.end()
  })

  // TODO: this rule won't apply when we use highest-work chain instead of longest
  t.test('with shorter fork', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    let headers = mine(chain, 10, false)
    mine(chain, 11)
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'New tip is not higher than current tip')
    }
    t.end()
  })

  // TODO: this rule won't apply when we use highest-work chain instead of longest
  t.test('with long reorg', function (t) {
    let chain = new Blockchain({
      start: testGenesis,
      maxTarget: testMaxTarget
    })
    mine(chain, 10)
    let headers = mine(chain, 2019, false)
    mine(chain, 2018)
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Reorg deeper than 2016 blocks')
    }
    t.end()
  })

  t.test('with incorrect prevHash', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)

    let headers = mine(chain, 10, false)
    headers[0].prevHash = headers[1].prevHash
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Header not connected to previous')
    }

    headers = mine(chain, 10, false)
    headers[5].prevHash = headers[4].prevHash
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Header not connected to previous')
    }

    t.end()
  })

  t.test('with skipped header', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    let headers = mine(chain, 10, false)
    headers.splice(5, 1)
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Expected height to be one higher than previous')
    }
    t.end()
  })

  t.test('with timestamp below median of prev 11', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    let headers = mine(chain, 10, false)
    headers[9].timestamp = headers[3].timestamp
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Timestamp is not greater than median of previous 11 timestamps')
    }
    t.end()
  })

  t.test('with timestamp too far ahead of previous', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    mine(chain, 10)
    let headers = mine(chain, 10, false)
    headers[5].timestamp += 480000
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Timestamp is too far ahead of previous timestamp')
    }
    t.end()
  })

  t.test('with incorrect retarget', function (t) {
    let chain = new Blockchain({ start: testGenesis, maxTarget: testMaxTarget })
    let headers = mine(chain, 2016, false)
    headers[2015].bits += 1
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Incorrect difficulty')
    }
    t.end()
  })

  t.test('with unexpected difficulty change', function (t) {
    let chain = new Blockchain({ start: testGenesis, maxTarget: testMaxTarget })
    let headers = mine(chain, 10, false)
    headers[5].bits += 1
    try {
      chain.add(headers)
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Unexpected difficulty change')
    }
    t.end()
  })

  t.test('with invalid proof-of-work', function (t) {
    let chain = new Blockchain({ start: testGenesis })
    let header = createHeader(testGenesis, null, null, false)
    try {
      chain.add([ header ])
      t.fail()
    } catch (err) {
      t.equals(err.message, 'Hash is above target')
    }
    t.end()
  })

  t.test('with valid reorg', function (t) {
    let store = []
    let chain = new Blockchain({ start: testGenesis, store })
    let toAdd = mine(chain, 10, false)
    let toReorg = mine(chain, 2)
    chain.once('reorg', (e) => {
      t.deepEquals(e, {
        remove: toReorg.reverse(),
        add: toAdd
      })
      t.notEqual(store[1], toReorg[0])
      t.equal(chain.height(), 10)
      t.end()
    })
    chain.add(toAdd)
  })

  t.end()
})
