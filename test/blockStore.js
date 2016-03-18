var test = require('tap').test
var bitcoinjs = require('bitcoinjs-lib')
var memdown = require('memdown')
var levelup = require('levelup')
var u = require('bitcoin-util')
var BlockStore = require('../lib/blockStore.js')

// TODO: get/setTip tests
// TODO: tests for put with { tip: true }

function createBlock () {
  var header = blockFromObject({
    version: 1,
    prevHash: u.toHash('0000000000000000000000000000000000000000000000000000000000000000'),
    merkleRoot: u.toHash('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'),
    timestamp: Math.floor(Date.now() / 1000),
    bits: 0x1d00ffff,
    nonce: Math.floor(Math.random() * 0xffffff)
  })
  return { height: Math.floor(Math.random() * 400000), header: header }
}

function blockFromObject (obj) {
  var block = new bitcoinjs.Block()
  for (var k in obj) block[k] = obj[k]
  return block
}

test('open blockstore', function (t) {
  var db = levelup('test', { db: memdown })
  var bs1 = new BlockStore({ db: db }, t.error)
  bs1.on('error', t.error)
  bs1.close(t.end)
})

test('blockstore put', function (t) {
  var db = levelup('test2', { db: memdown })
  var bs = new BlockStore({ db: db })
  var block = createBlock()

  t.test('simple put', function (t) {
    bs.put(block, t.end)
  })
  t.test('put existing block', function (t) {
    bs.put(block, t.end)
  })
  t.test('put invalid blocks', function (t) {
    t.test('empty', function (t) {
      bs.put({}, t.end)
    })
    t.test('no header', function (t) {
      bs.put({ height: 123 }, t.end)
    })
    t.test('no height', function (t) {
      bs.put({ header: block.header }, t.end)
    })
    t.end()
  })
  t.test('put after close', function (t) {
    bs.close(function (err) {
      t.error(err)
      bs.put(block, t.end)
    })
  })
  t.end()
})

test('blockstore get', function (t) {
  var db = levelup('test3', { db: memdown })
  var bs = new BlockStore({ db: db })
  var block1 = createBlock()
  bs.put(block1, function (err) {
    t.error(err)
    t.test('get using `hex string hash`', function (t) {
      bs.get(block1.header.getId(), function (err, block2) {
        t.error(err)
        // compare blocks
        t.equal(block1.height, block2.height)
        t.equal(block1.header.getId(), block2.header.getId())
        t.deepEqual(block1.header, block2.header)
        t.end()
      })
    })
    t.test('get using buffer hash', function (t) {
      bs.get(block1.header.getHash(), function (err, block2) {
        t.error(err)
        // compare blocks
        t.equal(block1.height, block2.height)
        t.equal(block1.header.getId(), block2.header.getId())
        t.deepEqual(block1.header, block2.header)
        t.end()
      })
    })
    t.test('get with an invalid length string key', function (t) {
      bs.get('1234', function (err, block2) {
        t.ok(err)
        t.equal(err.message, 'Invalid hash length')
        t.notOk(block2)
        t.end()
      })
    })
    t.test('get with an invalid type key', function (t) {
      bs.get(1234, function (err, block2) {
        t.ok(err)
        t.equal(err.message, 'Invalid hash')
        t.notOk(block2)
        t.end()
      })
    })
    t.test('get a valid, nonexistent hash', function (t) {
      var block3 = createBlock()
      bs.get(block3.header.getId(), function (err, block2) {
        t.ok(err)
        t.equal(err.name, 'NotFoundError')
        t.notOk(block2)
        t.end()
      })
    })
    t.test('closing', function (t) {
      bs.close(t.end)
    })
    t.end()
  })
})
