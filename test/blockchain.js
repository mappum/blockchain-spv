var test = require('tape')
var bitcore = require('bitcore-lib')
var u = require('bitcoin-util')
var memdown = require('memdown')
var params = require('webcoin-bitcoin').blockchain
var BlockStore = require('../lib/blockStore.js')
var Blockchain = require('../lib/blockchain.js')

function deleteStore (store, cb) {
  memdown.clearGlobalStore()
  cb()
}

function endStore (store, t) {
  store.close(function (err) {
    t.error(err)
    deleteStore(store, t.end)
  })
}

var maxTarget = new Buffer('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex')

function createBlock (prev, nonce, bits, validProof) {
  var i = nonce || 0
  validProof = validProof == null ? true : validProof
  var header
  do {
    header = new bitcore.BlockHeader({
      version: 1,
      prevHash: prev ? u.toHash(prev.hash) : u.nullHash,
      merkleRoot: u.nullHash,
      time: prev ? (prev.time + 1) : Math.floor(Date.now() / 1000),
      bits: bits || (prev ? prev.bits : u.compressTarget(maxTarget)),
      nonce: i++
    })
  } while ((validProof && !header.validProofOfWork()) ||
        (!validProof && header.validProofOfWork()))
  return header
}

var defaultTestParams = {
  genesisHeader: {
    version: 1,
    prevHash: u.nullHash,
    merkleRoot: u.nullHash,
    time: Math.floor(Date.now() / 1000),
    bits: u.compressTarget(maxTarget),
    nonce: 0
  },
  checkpoints: null
}

function createTestParams (opts) {
  var testParams = Object.assign({}, params)
  testParams = Object.assign(testParams, defaultTestParams)
  return Object.assign(testParams, opts)
}

test('creating blockchain instances', function (t) {
  t.test('create blockchain with instantiated BlockStore', function (t) {
    t.doesNotThrow(function () {
      var store = new BlockStore({ db: memdown })
      var chain = new Blockchain({ store: store, params: params })
      endStore(chain.store, t)
    })
  })
  t.test('create blockchain with db instead of store', function (t) {
    t.doesNotThrow(function () {
      var chain = new Blockchain({ db: memdown, params: params })
      endStore(chain.store, t)
    })
  })
  t.end()
})

test('blockchain paths', function (t) {
  var testParams = createTestParams({
    genesisHeader: {
      version: 1,
      prevHash: u.nullHash,
      merkleRoot: u.nullHash,
      time: Math.floor(Date.now() / 1000),
      bits: u.compressTarget(maxTarget),
      nonce: 0
    },
    interval: 10
  })
  var genesis = new bitcore.BlockHeader(testParams.genesisHeader)
  var chain = new Blockchain({
    maxTarget: maxTarget,
    params: testParams
  })

  var headers = []
  t.test('headers add to blockchain', function (t) {
    var block = genesis
    for (var i = 0; i < 10; i++) {
      block = createBlock(block)
      headers.push(block)
    }
    chain.processHeaders(headers, t.end)
  })

  t.test('simple path with no fork', function (t) {
    var from = { height: 2, header: headers[1] }
    var to = { height: 10, header: headers[9] }
    chain.getPath(from, to, function (err, path) {
      if (err) return t.end(err)
      t.ok(path)
      t.ok(path.add)
      t.ok(path.remove)
      t.notOk(path.fork)
      t.equal(path.add.length, 8)
      t.equal(path.add[0].height, 3)
      t.equal(path.add[0].header.hash, headers[2].hash)
      t.equal(path.add[7].height, 10)
      t.equal(path.add[7].header.hash, to.header.hash)
      t.equal(path.remove.length, 0)
      t.end()
    })
  })

  t.test('backwards path with no fork', function (t) {
    var from = { height: 10, header: headers[9] }
    var to = { height: 2, header: headers[1] }
    chain.getPath(from, to, function (err, path) {
      if (err) return t.end(err)
      t.ok(path)
      t.ok(path.add)
      t.ok(path.remove)
      t.notOk(path.fork)
      t.equal(path.remove.length, 8)
      t.equal(path.remove[0].height, 10)
      t.equal(path.remove[0].header.hash, from.header.hash)
      t.equal(path.remove[7].height, 3)
      t.equal(path.remove[7].header.hash, headers[2].hash)
      t.equal(path.add.length, 0)
      t.end()
    })
  })

  var headers2 = []
  t.test('fork headers add to blockchain', function (t) {
    var block = headers[4]
    for (var i = 0; i < 10; i++) {
      block = createBlock(block, 0xffffff)
      headers2.push(block)
    }
    chain.processHeaders(headers2, t.end)
  })

  t.test('path with fork', function (t) {
    var from = { height: 10, header: headers[9] }
    var to = { height: 15, header: headers2[9] }
    chain.getPath(from, to, function (err, path) {
      if (err) return t.end(err)
      t.ok(path)
      t.ok(path.add)
      t.ok(path.remove)
      t.equal(path.fork.header.hash, headers[4].hash)
      t.equal(path.remove.length, 5)
      t.equal(path.remove[0].height, 10)
      t.equal(path.remove[0].header.hash, from.header.hash)
      t.equal(path.remove[4].height, 6)
      t.equal(path.remove[4].header.hash, headers[5].hash)
      t.equal(path.add.length, 10)
      t.equal(path.add[0].height, 6)
      t.equal(path.add[0].header.hash, headers2[0].hash)
      t.equal(path.add[9].height, 15)
      t.equal(path.add[9].header.hash, headers2[9].hash)
      t.end()
    })
  })

  t.test('backwards path with fork', function (t) {
    var from = { height: 15, header: headers2[9] }
    var to = { height: 10, header: headers[9] }
    chain.getPath(from, to, function (err, path) {
      if (err) return t.end(err)
      t.ok(path)
      t.ok(path.add)
      t.ok(path.remove)
      t.equal(path.fork.header.hash, headers[4].hash)
      t.equal(path.remove.length, 10)
      t.equal(path.remove[0].height, 15)
      t.equal(path.remove[0].header.hash, from.header.hash)
      t.equal(path.remove[9].height, 6)
      t.equal(path.remove[9].header.hash, headers2[0].hash)
      t.equal(path.add.length, 5)
      t.equal(path.add[0].height, 6)
      t.equal(path.add[0].header.hash, headers[5].hash)
      t.equal(path.add[4].height, 10)
      t.equal(path.add[4].header.hash, headers[9].hash)
      t.end()
    })
  })

  t.test('deleting blockstore', function (t) {
    endStore(chain.store, t)
  })
})

test('blockchain verification', function (t) {
  var testParams = createTestParams({
    interval: 10
  })
  var genesis = new bitcore.BlockHeader(testParams.genesisHeader)
  var chain = new Blockchain({
    genesis: genesis,
    params: testParams
  })

  var headers = []
  t.test('headers add to blockchain', function (t) {
    var block = genesis
    for (var i = 0; i < 9; i++) {
      block = createBlock(block)
      headers.push(block)
    }
    chain.processHeaders(headers, t.end)
  })

  t.test("error on header that doesn't connect", function (t) {
    var block = createBlock()
    chain.processHeaders([ block ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Block does not connect to chain')
      t.end()
    })
  })

  t.test('error on nonconsecutive headers', function (t) {
    var block1 = createBlock(headers[5], 10000)
    var block2 = createBlock(headers[6], 10000)

    chain.processHeaders([ block1, block2 ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Block does not connect to previous')
      t.end()
    })
  })

  t.test('error on header with unexpected difficulty change', function (t) {
    var block = createBlock(headers[5])
    block.bits = 0x1d00ffff
    chain.processHeaders([ block ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Unexpected difficulty change at height 7')
      t.end()
    })
  })

  t.test('error on header with invalid proof of work', function (t) {
    var block = createBlock(headers[8], 0, genesis.bits, false)
    chain.processHeaders([ block ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Mining hash is above target')
      t.end()
    })
  })

  t.test('error on header with invalid difficulty change', function (t) {
    var block = createBlock(headers[8], 0, 0x1f70ffff)
    chain.processHeaders([ block ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Bits in block (1f70ffff) is different than expected (207fffff)')
      t.end()
    })
  })

  t.test('accept valid difficulty change', function (t) {
    var block = createBlock(headers[8], 0, 0x207fffff)
    chain.processHeaders([ block ], t.end)
  })

  t.test('teardown', function (t) {
    endStore(chain.store, t)
  })
})

test('blockchain queries', function (t) {
  var testParams = createTestParams()
  var genesis = new bitcore.BlockHeader(testParams.genesisHeader)
  var chain = new Blockchain({
    maxTarget: maxTarget,
    genesis: genesis,
    params: testParams
  })

  var headers = []
  t.test('setup', function (t) {
    var block = genesis
    for (var i = 0; i < 100; i++) {
      block = createBlock(block)
      headers.push(block)
    }
    chain.processHeaders(headers, t.end)
  })

  t.test('get block at height', function (t) {
    t.plan(14)

    chain.getBlockAtHeight(10, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 10)
      t.equal(block.header.hash, headers[9].hash)
    })

    chain.getBlockAtHeight(90, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 90)
      t.equal(block.header.hash, headers[89].hash)
    })

    chain.getBlockAtHeight(200, function (err, block) {
      t.ok(err)
      t.notOk(block)
      t.equal(err.message, 'height is higher than tip')
    })

    chain.getBlockAtHeight(-10, function (err, block) {
      t.ok(err)
      t.notOk(block)
      t.equal(err.message, 'height must be >= 0')
    })
  })

  t.test('get block at time', function (t) {
    t.plan(16)

    chain.getBlockAtTime(genesis.time + 10, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 10)
      t.equal(block.header.hash, headers[9].hash)
    })

    chain.getBlockAtTime(genesis.time + 90, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 90)
      t.equal(block.header.hash, headers[89].hash)
    })

    chain.getBlockAtTime(genesis.time + 200, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 100)
      t.equal(block.header.hash, headers[99].hash)
    })

    chain.getBlockAtTime(genesis.time - 10, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 0)
      t.equal(block.header.hash, genesis.hash)
    })
  })

  t.test('get block', function (t) {
    t.plan(14)

    chain.getBlock(u.toHash(headers[50].hash), function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 51)
      t.equal(block.header.hash, headers[50].hash)
    })

    chain.getBlock(10, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 10)
      t.equal(block.header.hash, headers[9].hash)
    })

    chain.getBlock(genesis.time + 20, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 20)
      t.equal(block.header.hash, headers[19].hash)
    })

    chain.getBlock(':)', function (err, block) {
      t.ok(err)
      t.equal(err.message, '"at" must be a block hash, height, or timestamp')
    })
  })

  t.test('teardown', function (t) {
    endStore(chain.store, t)
  })
})
