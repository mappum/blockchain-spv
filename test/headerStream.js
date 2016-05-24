var wrapEvents = require('event-cleanup')
var levelup = require('levelup')
var memdown = require('memdown')
var test = require('tape')
var Blockchain = require('../lib/blockchain.js')
var HeaderStream = require('../lib/headerStream.js')
var utils = require('./utils.js')

var testParams = utils.createTestParams()
var genesis = utils.blockFromObject(testParams.genesisHeader)
var headers
var chain

test('setup blockchain', function (t) {
  t.test('create chain', function (t) {
    var db = levelup('headerStream.chain', { db: memdown })
    chain = new Blockchain(testParams, db)
    chain.onceReady(t.end.bind(t))
  })

  t.test('add headers', function (t) {
    var prev = genesis
    headers = []
    for (var i = 0; i < 10; i++) {
      prev = headers[i] = utils.createBlock(prev)
    }
    chain.addHeaders(headers, function (err) {
      t.error(err)
      t.end()
    })
  })
})

test('create HeaderStream', function (t) {
  t.test('no chain', function (t) {
    try {
      var hs = new HeaderStream()
      t.notOk(hs, 'should have thrown error')
    } catch (err) {
      t.ok(err, 'threw error')
      t.equal(err.message, '"chain" argument is required', 'correct error message')
      t.end()
    }
  })

  t.test('constructor', function (t) {
    var hs = new HeaderStream(chain)
    t.ok(hs instanceof HeaderStream, 'got HeaderStream')
    t.end()
  })

  t.test('optional "new"', function (t) {
    var hs = HeaderStream(chain)
    t.ok(hs instanceof HeaderStream, 'got HeaderStream')
    t.end()
  })

  t.test('via Blockchain#createReadStream()', function (t) {
    var hs = chain.createReadStream()
    t.ok(hs instanceof HeaderStream, 'got HeaderStream')
    t.end()
  })

  t.end()
})

test('simple streaming', function (t) {
  var hs = chain.createReadStream()
  var events = wrapEvents(hs)

  t.test('streaming stored headers', function (t) {
    var height = 0
    events.on('data', function (block) {
      t.equal(block.height, height++, 'correct height')
      t.ok(block.header, 'block has header')
      t.ok(block.add, 'block.add === true')
      if (height === 11) {
        t.notOk(hs.read(), 'no more headers to read')
        events.removeAll()
        t.end()
      }
    })
  })

  t.test('streaming new headers', function (t) {
    var block1 = utils.createBlock(chain.tip.header)
    events.on('data', function (block2) {
      t.pass('data pushed')
      t.equal(block2.height, 11, 'correct height')
      t.deepEqual(block2.header, block1, 'correct header')
      t.ok(block2.add, 'block.add === true')
      events.removeAll()
      t.end()
    })
    chain.addHeaders([ block1 ], function () {})
  })

  t.test('end', function (t) {
    hs.once('end', t.end.bind(t))
    hs.end()
  })
})

test('stream options', function (t) {
  t.test('from', function (t) {
    var hs = chain.createReadStream({ from: headers[3].getHash() })
    var i = 5
    hs.on('data', function (block) {
      t.equal(block.height, i, 'correct height')
      t.deepEqual(block.header, headers[i - 1], 'correct header')
      t.ok(block.add, 'block.add === true')
      i++
      if (i === 11) {
        hs.end()
        t.end()
      }
    })
  })

  t.test('stopHash', function (t) {
    var hs = chain.createReadStream({ stopHash: headers[3].getHash() })
    var i = 0
    hs.on('data', function (block) {
      t.equal(block.height, i, 'correct height')
      var header = i > 0 ? headers[i - 1] : genesis
      t.deepEqual(block.header, header, 'correct header')
      t.ok(block.add, 'block.add === true')
      i++
    })
    hs.once('end', function () {
      t.equal(i, 5, 'stopped at correct height')
      t.end()
    })
  })

  t.test('stopHeight', function (t) {
    var hs = chain.createReadStream({ stopHeight: 4 })
    var i = 0
    hs.on('data', function (block) {
      t.equal(block.height, i, 'correct height')
      var header = i > 0 ? headers[i - 1] : genesis
      t.deepEqual(block.header, header, 'correct header')
      t.ok(block.add, 'block.add === true')
      i++
    })
    hs.once('end', function () {
      t.equal(i, 5, 'stopped at correct height')
      t.end()
    })
  })
})
