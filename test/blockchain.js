var test = require('tape')
var bitcoinjs = require('bitcoinjs-lib')
var u = require('bitcoin-util')
var levelup = require('levelup')
var memdown = require('memdown')
var reverse = require('buffer-reverse')
var params = require('webcoin-bitcoin').blockchain
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

function blockFromObject (obj) {
  var block = new bitcoinjs.Block()
  for (var k in obj) block[k] = obj[k]
  return block
}

var maxTarget = new Buffer('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex')

function validProofOfWork (header) {
  var target = u.expandTarget(header.bits)
  var hash = reverse(header.getHash())
  return hash.compare(target) !== 1
}

function createBlock (prev, nonce, bits, validProof) {
  var i = nonce || 0
  validProof = validProof == null ? true : validProof
  var header
  do {
    header = blockFromObject({
      version: 1,
      prevHash: prev ? prev.getHash() : u.nullHash,
      merkleRoot: u.nullHash,
      timestamp: prev ? (prev.timestamp + 1) : Math.floor(Date.now() / 1000),
      bits: bits || (prev ? prev.bits : u.compressTarget(maxTarget)),
      nonce: i++
    })
  } while (validProof !== validProofOfWork(header))
  return header
}

var defaultTestParams = {
  genesisHeader: {
    version: 1,
    prevHash: u.nullHash,
    merkleRoot: u.nullHash,
    timestamp: Math.floor(Date.now() / 1000),
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

test('create blockchain instance', function (t) {
  var db = levelup('chain', { db: memdown })
  var chain = new Blockchain(params, db)
  chain.once('ready', function () { endStore(chain.store, t) })
})

test('blockchain paths', function (t) {
  var testParams = createTestParams({
    genesisHeader: {
      version: 1,
      prevHash: u.nullHash,
      merkleRoot: u.nullHash,
      timestamp: Math.floor(Date.now() / 1000),
      bits: u.compressTarget(maxTarget),
      nonce: 0
    }
  })
  var genesis = blockFromObject(testParams.genesisHeader)
  var db = levelup('paths.chain', { db: memdown })
  var chain

  t.test('setup chain', function (t) {
    chain = new Blockchain(testParams, db)
    chain.once('ready', t.end)
  })

  var headers = []
  t.test('headers add to blockchain', function (t) {
    t.plan(53)
    var block = genesis
    for (var i = 0; i < 10; i++) {
      block = createBlock(block)
      headers.push(block);
      (function (block) {
        chain.on('block:' + block.getHash().toString('base64'), (block2) => {
          t.equal(block, block2.header)
        })
      })(block)
    }

    var blockIndex = 0
    chain.on('block', (block) => {
      t.equal(block.height, blockIndex + 1)
      t.equal(block.header, headers[blockIndex++])
    })

    var tipIndex = 0
    chain.on('tip', (block) => {
      t.equal(block.height, tipIndex + 1)
      t.equal(block.header, headers[tipIndex++])
    })

    chain.once('headers', (headers2) => {
      t.equal(headers2, headers)
    })
    chain.addHeaders(headers, (err) => {
      t.pass('addHeaders cb called')
      t.error(err)
    })
  })

  t.test('remove listeners', function (t) {
    chain.removeAllListeners('block')
    chain.removeAllListeners('tip')
    chain.removeAllListeners('blocks')
    t.end()
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
      t.equal(path.add[0].header.getId(), headers[2].getId())
      t.equal(path.add[7].height, 10)
      t.equal(path.add[7].header.getId(), to.header.getId())
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
      t.equal(path.remove[0].header.getId(), from.header.getId())
      t.equal(path.remove[7].height, 3)
      t.equal(path.remove[7].header.getId(), headers[2].getId())
      t.equal(path.add.length, 0)
      t.end()
    })
  })

  var headers2 = []
  t.test('fork headers add to blockchain', function (t) {
    var block = headers[4]
    for (var i = 0; i < 6; i++) {
      block = createBlock(block, 0xffffff)
      headers2.push(block)
    }
    chain.on('reorg', function (e) {
      t.ok(e, 'got reorg event')
      t.equal(e.path.remove.length, 5, 'removed blocks is correct length')
      t.equal(e.path.remove[0].height, 10)
      t.equal(e.path.remove[0].header.getId(), headers[9].getId())
      t.equal(e.path.remove[1].height, 9)
      t.equal(e.path.remove[1].header.getId(), headers[8].getId())
      t.equal(e.path.remove[2].height, 8)
      t.equal(e.path.remove[2].header.getId(), headers[7].getId())
      t.equal(e.path.remove[3].height, 7)
      t.equal(e.path.remove[3].header.getId(), headers[6].getId())
      t.equal(e.path.remove[4].height, 6)
      t.equal(e.path.remove[4].header.getId(), headers[5].getId())
      t.equal(e.path.add.length, 6, 'added blocks is correct length')
      t.equal(e.path.add[0].height, 6)
      t.equal(e.path.add[0].header.getId(), headers2[0].getId())
      t.equal(e.path.add[1].height, 7)
      t.equal(e.path.add[1].header.getId(), headers2[1].getId())
      t.equal(e.path.add[2].height, 8)
      t.equal(e.path.add[2].header.getId(), headers2[2].getId())
      t.equal(e.path.add[3].height, 9)
      t.equal(e.path.add[3].header.getId(), headers2[3].getId())
      t.equal(e.path.add[4].height, 10)
      t.equal(e.path.add[4].header.getId(), headers2[4].getId())
      t.equal(e.path.add[5].height, 11)
      t.equal(e.path.add[5].header.getId(), headers2[5].getId())
      t.ok(e.tip)
      t.equal(e.tip.height, 11)
      t.equal(e.tip.header.getId(), headers2[5].getId())
      t.end()
    })
    chain.addHeaders(headers2, t.error)
  })

  t.test('path with fork', function (t) {
    var from = { height: 10, header: headers[9] }
    var to = { height: 11, header: headers2[5] }
    chain.getPath(from, to, function (err, path) {
      if (err) return t.end(err)
      t.ok(path)
      t.ok(path.add)
      t.ok(path.remove)
      t.equal(path.fork.header.getId(), headers[4].getId())
      t.equal(path.remove.length, 5)
      t.equal(path.remove[0].height, 10)
      t.equal(path.remove[0].header.getId(), from.header.getId())
      t.equal(path.remove[4].height, 6)
      t.equal(path.remove[4].header.getId(), headers[5].getId())
      t.equal(path.add.length, 6)
      t.equal(path.add[0].height, 6)
      t.equal(path.add[0].header.getId(), headers2[0].getId())
      t.equal(path.add[5].height, 11)
      t.equal(path.add[5].header.getId(), headers2[5].getId())
      t.end()
    })
  })

  t.test('backwards path with fork', function (t) {
    var from = { height: 11, header: headers2[5] }
    var to = { height: 10, header: headers[9] }
    chain.getPath(from, to, function (err, path) {
      if (err) return t.end(err)
      t.ok(path)
      t.ok(path.add)
      t.ok(path.remove)
      t.equal(path.fork.header.getId(), headers[4].getId())
      t.equal(path.remove.length, 6)
      t.equal(path.remove[0].height, 11)
      t.equal(path.remove[0].header.getId(), from.header.getId())
      t.equal(path.remove[5].height, 6)
      t.equal(path.remove[5].header.getId(), headers2[0].getId())
      t.equal(path.add.length, 5)
      t.equal(path.add[0].height, 6)
      t.equal(path.add[0].header.getId(), headers[5].getId())
      t.equal(path.add[4].height, 10)
      t.equal(path.add[4].header.getId(), headers[9].getId())
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
  var db = levelup('verification.chain', { db: memdown })
  var chain = new Blockchain(testParams, db)

  var headers = []
  var genesis = blockFromObject(testParams.genesisHeader)
  t.test('headers add to blockchain', function (t) {
    var block = genesis
    for (var i = 0; i < 9; i++) {
      block = createBlock(block)
      headers.push(block)
    }
    chain.addHeaders(headers, t.end)
  })

  t.test('error on header that doesn\'t connect', function (t) {
    var block = createBlock()
    chain.addHeaders([ block ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Block does not connect to chain')
      t.end()
    })
  })

  t.test('error on nonconsecutive headers', function (t) {
    var block1 = createBlock(headers[5], 10000)
    var block2 = createBlock(headers[6], 10000)

    chain.addHeaders([ block1, block2 ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Block does not connect to previous')
      t.end()
    })
  })

  t.test('error on header with unexpected difficulty change', function (t) {
    var block = createBlock(headers[5])
    block.bits = 0x1d00ffff
    chain.addHeaders([ block ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Unexpected difficulty change at height 7')
      t.end()
    })
  })

  t.test('error on header with invalid proof of work', function (t) {
    var block = createBlock(headers[8], 0, genesis.bits, false)
    chain.addHeaders([ block ], function (err) {
      t.ok(err)
      t.ok(err.message.indexOf('Mining hash is above target') === 0)
      t.end()
    })
  })

  t.test('error on header with invalid difficulty change', function (t) {
    var block = createBlock(headers[8], 0, 0x1f70ffff)
    chain.addHeaders([ block ], function (err) {
      t.ok(err)
      t.equal(err.message, 'Bits in block (1f70ffff) different than expected (201fffff)')
      t.end()
    })
  })

  t.test('accept valid difficulty change', function (t) {
    var block = createBlock(headers[8], 0, 0x201fffff)
    chain.addHeaders([ block ], t.end)
  })

  t.test('teardown', function (t) {
    endStore(chain.store, t)
  })
})

test('blockchain queries', function (t) {
  var testParams = createTestParams()
  var genesis = blockFromObject(testParams.genesisHeader)
  var db = levelup('queries.chain', { db: memdown })
  var chain = new Blockchain(testParams, db)

  var headers = []
  t.test('setup', function (t) {
    var block = genesis
    for (var i = 0; i < 100; i++) {
      block = createBlock(block)
      headers.push(block)
    }
    chain.addHeaders(headers, t.end)
  })

  t.test('get block at height', function (t) {
    t.plan(14)

    chain.getBlockAtHeight(10, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 10)
      t.equal(block.header.getId(), headers[9].getId())
    })

    chain.getBlockAtHeight(90, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 90)
      t.equal(block.header.getId(), headers[89].getId())
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

    chain.getBlockAtTime(genesis.timestamp + 9, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 10)
      t.equal(block.header.getId(), headers[9].getId())
    })

    chain.getBlockAtTime(genesis.timestamp + 89, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 90)
      t.equal(block.header.getId(), headers[89].getId())
    })

    chain.getBlockAtTime(genesis.timestamp + 200, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 100)
      t.equal(block.header.getId(), headers[99].getId())
    })

    chain.getBlockAtTime(genesis.timestamp - 10, function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 0)
      t.equal(block.header.getId(), genesis.getId())
    })
  })

  t.test('get block by hash', function (t) {
    t.plan(6)

    chain.getBlock(headers[50].getHash(), function (err, block) {
      t.error(err)
      t.ok(block)
      t.equal(block.height, 51)
      t.equal(block.header.getId(), headers[50].getId())
    })

    chain.getBlock(123, function (err, block) {
      t.ok(err)
      t.equal(err.message, '"hash" must be a Buffer')
    })
  })

  t.test('teardown', function (t) {
    endStore(chain.store, t)
  })
})
