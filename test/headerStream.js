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
})

var headers2
test('reorgs', function (t) {
  t.test('simple reorg', function (t) {
    headers2 = []
    var prev = headers[7]
    for (var i = 0; i < 4; i++) {
      prev = headers2[i] = utils.createBlock(prev, 1000)
    }
    var expected = [
      { height: 11, header: chain.tip.header, add: false },
      { height: 10, header: headers[9], add: false },
      { height: 9, header: headers[8], add: false },
      { height: 9, header: headers2[0], add: true },
      { height: 10, header: headers2[1], add: true },
      { height: 11, header: headers2[2], add: true },
      { height: 12, header: headers2[3], add: true }
    ]
    var hs = chain.createReadStream({ from: chain.tip.hash })
    hs.on('data', function (block1) {
      var block2 = expected.shift()
      t.equal(block1.height, block2.height, 'correct height')
      t.deepEqual(block1.header, block2.header, 'correct header')
      t.equal(block1.add, block2.add, 'correct add/remove')
      if (expected.length === 0) {
        hs.end()
      }
    })
    // reorg once stream is initialized
    hs.once('init', () => {
      chain.addHeaders(headers2, function (err) {
        t.error(err, 'no error')
        t.end()
      })
    })
  })

  t.test('start stream on a fork', function (t) {
    var expected = [
      { height: 10, header: headers[9], add: false },
      { height: 9, header: headers[8], add: false },
      { height: 9, header: headers2[0], add: true },
      { height: 10, header: headers2[1], add: true },
      { height: 11, header: headers2[2], add: true },
      { height: 12, header: headers2[3], add: true }
    ]
    var hs = chain.createReadStream({ from: headers[9].getHash() })
    hs.on('data', function (block1) {
      var block2 = expected.shift()
      t.equal(block1.height, block2.height, 'correct height')
      t.deepEqual(block1.header, block2.header, 'correct header')
      t.equal(block1.add, block2.add, 'correct add/remove')
      if (expected.length === 0) {
        hs.end()
        t.end()
      }
    })
  })

  t.test('reorg while stream initializes', function (t) {
    var headers3 = []
    var prev = headers[7]
    for (var i = 0; i < 6; i++) {
      prev = headers3[i] = utils.createBlock(prev, 2000)
    }
    var expected = [
      { height: 12, header: chain.tip.header, add: false },
      { height: 11, header: headers2[2], add: false },
      { height: 10, header: headers2[1], add: false },
      { height: 9, header: headers2[0], add: false },
      { height: 9, header: headers3[0], add: true },
      { height: 10, header: headers3[1], add: true },
      { height: 11, header: headers3[2], add: true },
      { height: 12, header: headers3[3], add: true },
      { height: 13, header: headers3[4], add: true },
      { height: 14, header: headers3[5], add: true }
    ]
    var hs = chain.createReadStream({ from: chain.tip.hash })
    hs.on('data', function (block1) {
      var block2 = expected.shift()
      t.equal(block1.height, block2.height, 'correct height')
      t.deepEqual(block1.header, block2.header, 'correct header')
      t.equal(block1.add, block2.add, 'correct add/remove')
      if (expected.length === 0) {
        hs.end()
      }
    })
    // reorg happens now, while stream is still initializing
    // (the stream is checking to see if it is on a fork)
    chain.addHeaders(headers3, function (err) {
      t.error(err, 'no error')
      t.end()
    })
  })
})
