var EventEmitter = require('events').EventEmitter
var async = require('async')
var u = require('bitcoin-util')
var Block = require('bitcoinjs-lib').Block
var to = require('flush-write-stream').obj
var inherits = require('inherits')
var BlockStore = require('./blockStore.js')

if (process.browser) {
  require('setimmediate')
}

var storeClosedError = new Error('Store is closed')

function validParameters (params) {
  return typeof params.genesisHeader === 'object' &&
    typeof params.shouldRetarget === 'function' &&
    typeof params.calculateTarget === 'function' &&
    typeof params.miningHash === 'function'
}

function blockFromObject (obj) {
  return Object.assign(new Block(), obj)
}

var Blockchain = module.exports = function (params, db, opts) {
  if (!params || !validParameters(params)) {
    throw new Error('Invalid network parameters')
  }
  if (!db) throw new Error('Must specify db')
  this.params = params
  opts = opts || {}

  var genesisHeader = blockFromObject(params.genesisHeader)
  this.genesis = this.tip = {
    height: 0,
    hash: genesisHeader.getHash(),
    header: genesisHeader
  }

  if (params.checkpoints && !opts.ignoreCheckpoints) {
    var lastCheckpoint = params.checkpoints[params.checkpoints.length - 1]
    this.checkpoint = {
      height: lastCheckpoint.height,
      header: blockFromObject(lastCheckpoint.header)
    }
    this.checkpoint.hash = this.checkpoint.header.getHash()
    this.tip = this.checkpoint
  }

  this.initialized = false
  this.closed = false

  this.store = new BlockStore({ db: db })
  this._initialize()
}
inherits(Blockchain, EventEmitter)

Blockchain.prototype._initialize = function () {
  if (this.initialized) {
    return this._error(new Error('Already initialized'))
  }

  var self = this
  this._initStore(function (err) {
    if (err) return self._error(err)
    self.store.getTip(function (err, tip) {
      if (err && err.name !== 'NotFoundError') return self._error(err)
      if (tip) self.tip = tip
      self.initialized = true
      self.emit('ready')
    })
  })
}

Blockchain.prototype._initStore = function (cb) {
  var self = this

  function putIfNotFound (block) {
    return function (cb) {
      self.store.get(block.hash, function (err) {
        if (err && !err.notFound) return cb(err)
        if (self.closed || self.store.isClosed()) return cb(storeClosedError)
        self.store.put(block, cb)
      })
    }
  }

  var tasks = [ putIfNotFound(this.genesis) ]
  if (this.checkpoint) tasks.push(putIfNotFound(this.checkpoint))
  async.parallel(tasks, cb)
}

Blockchain.prototype.onceReady = function (cb) {
  if (this.initialized) return cb()
  this.once('ready', cb)
}

Blockchain.prototype.close = function (cb) {
  var self = this
  this.onceReady(function () {
    self.closed = true
    self.store.close(cb)
  })
}

Blockchain.prototype.getTip = function () {
  return this.tip
}

Blockchain.prototype.getPath = function (from, to, cb) {
  var self = this
  var output = {
    add: [],
    remove: [],
    fork: null
  }

  var top, bottom, down
  if (from.height > to.height) {
    top = from
    bottom = to
    down = true
  } else {
    top = to
    bottom = from
    down = false
  }

  function addTraversedBlock (block) {
    if (down &&
    block.header.getHash().compare(to.header.getHash()) !== 0) {
      output.remove.push(block)
    } else if (!down &&
    block.header.getHash().compare(from.header.getHash()) !== 0) {
      output.add.unshift(block)
    }
  }

  // traverse down from the higher block to the lower block
  function traverseDown (err, block) {
    if (err) return cb(err)
    if (block.height === bottom.height) {
      // we traversed down to the lower height
      if (block.header.getHash().compare(bottom.header.getHash()) === 0) {
        // the blocks are the same, there was no fork
        addTraversedBlock(block)
        return cb(null, output)
      }
      // the blocks are not the same, so we need to traverse down to find a fork
      return traverseToFork(block, bottom)
    }
    addTraversedBlock(block)
    self.getBlock(block.header.prevHash, traverseDown)
  }
  traverseDown(null, top)

  // traverse down from both blocks until we find one block that is the same
  function traverseToFork (left, right) {
    if (left.height === 0 || right.height === 0) {
      // we got all the way to two different genesis blocks,
      // the blocks don't have a path between them
      return cb(new Error('Blocks are not in the same chain'))
    }

    output.remove.push(down ? left : right)
    output.add.unshift(down ? right : left)

    self.getBlock(left.header.prevHash, function (err, left) {
      if (err) return cb(err)
      self.getBlock(right.header.prevHash, function (err, right) {
        if (err) return cb(err)
        if (left.header.getHash().compare(right.header.getHash()) === 0) {
          output.fork = left
          return cb(null, output)
        }
        traverseToFork(left, right)
      })
    })
  }
}

Blockchain.prototype.getPathToTip = function (from, cb) {
  this.getPath(from, this.tip, cb)
}

Blockchain.prototype.getBlock = function (hash, cb) {
  if (!Buffer.isBuffer(hash)) {
    return cb(new Error('"hash" must be a Buffer'))
  }
  var self = this
  if (!this.initialized) {
    this.once('ready', function () { self.getBlock(hash, cb) })
    return
  }
  this.store.get(hash, cb)
}

Blockchain.prototype.getBlockAtTime = function (time, cb) {
  var self = this
  var output = this.tip
  function traverse (err, block) {
    if (err) return cb(err)
    if (block.header.timestamp <= time) return cb(null, output)
    if (block.header.timestamp >= time) output = block
    if (block.height === 0) return cb(null, output)
    self.getBlock(block.header.prevHash, traverse)
  }
  traverse(null, this.tip)
}

Blockchain.prototype.getBlockAtHeight = function (height, cb) {
  var self = this

  if (height > this.tip.height) return cb(new Error('height is higher than tip'))
  if (height < 0) return cb(new Error('height must be >= 0'))

  var down = height > this.tip.height / 2

  function traverse (err, block) {
    if (err) return cb(err)
    if (block.height === height) return cb(null, block)
    self.getBlock(down ? block.header.prevHash : u.toHash(block.next), traverse)
  }
  this.getBlock(down ? this.tip.hash : this.genesis.hash, traverse)
}

Blockchain.prototype.getLocator = function (from, cb) {
  if (typeof from === 'function') {
    cb = from
    from = this.getTip().hash
  }
  var self = this
  var locator = []
  function getBlock (from) {
    self.getBlock(from, function (err, block) {
      if (err && err.notFound) return cb(null, locator)
      if (err) return cb(err)
      locator.push(block.header.getHash())
      if (locator.length < 6 || !block.height === 0) {
        return getBlock(block.header.prevHash)
      }
      cb(null, locator)
    })
  }
  getBlock(from)
}

Blockchain.prototype._error = function (err) {
  this.emit('error', err)
}

Blockchain.prototype._put = function (hash, opts, cb) {
  var self = this
  if (!this.initialized) {
    this.once('ready', function () { self._put(hash, opts, cb) })
    return
  }
  this.store.put(hash, opts, cb)
}

Blockchain.prototype.createWriteStream = function () {
  return to({ highWaterMark: 4 }, (headers, enc, cb) => {
    this.addHeaders(headers, cb)
  })
}

Blockchain.prototype.addHeaders = function (headers, cb) {
  var self = this

  var previousTip = this.tip

  // TODO: store all orphan tips
  this.getBlock(headers[0].prevHash, function (err, start) {
    if (err && err.name === 'NotFoundError') return cb(new Error('Block does not connect to chain'))
    if (err) return cb(err)
    start.hash = start.header.getHash()

    async.reduce(headers, start, self._addHeader.bind(self), function (err, last) {
      if (err) return cb(err, last)

      // TODO: add even if it doesn't pass the current tip
      // (makes us store orphan forks, and lets us handle reorgs > 2000 blocks)
      if (last.height > previousTip.height) {
        self.getPath(previousTip, last, function (err, path) {
          if (err) return cb(err, last)
          if (path.remove.length > 0) {
            var first = { height: start.height + 1, header: headers[0] }
            self.store.put(first, { best: true, prev: start }, function (err) {
              if (err) return cb(err)
              self.emit('reorg', { remove: path.remove, tip: last })
              cb(null, last)
            })
            return
          }
          cb(null, last)
        })
        return
      }

      cb(null, last)
    })
  })
}

Blockchain.prototype._addHeader = function (prev, header, cb) {
  if (typeof header === 'function') {
    cb = header
    header = null
  }
  if (header == null) {
    header = prev
    prev = this.tip
  }

  var self = this
  var height = prev.height + 1
  var block = {
    height: height,
    hash: header.getHash(),
    header: header
  }

  if (header.prevHash.compare(prev.hash) !== 0) {
    return cb(new Error('Block does not connect to previous'), block)
  }
  this.params.shouldRetarget(block, function (err, retarget) {
    if (err) return cb(err)
    if (!retarget && header.bits !== prev.header.bits) {
      return cb(new Error('Unexpected difficulty change at height ' + height), block)
    }
    self.validProof(header, function (err, validProof) {
      if (err) return cb(err)
      if (!validProof) {
        return cb(new Error('Mining hash is above target. ' +
          'Hash: ' + header.getId() + ', ' +
          'Target: ' + u.expandTarget(header.bits).toString('hex') + ')'), block)
      }
      // TODO: other checks (timestamp, version)
      if (retarget) {
        return self.params.calculateTarget(block, self, function (err, target) {
          if (err) return cb(err, block)

          var expected = u.compressTarget(target)
          if (expected !== header.bits) {
            return cb(new Error('Bits in block (' + header.bits.toString(16) + ')' +
              ' different than expected (' + expected.toString(16) + ')'), block)
          }
          put()
        })
      }
      put()
    })
  })

  function put () {
    var tip = height > self.tip.height
    self._put({ header: header, height: height }, { tip: tip, prev: prev }, function (err) {
      if (err) return cb(err)

      if (tip) {
        self.tip = block
        self.emit('block', block)
      }

      cb(null, block)
    })
  }
}

Blockchain.prototype.validProof = function (header, cb) {
  this.params.miningHash(header, function (err, hash) {
    if (err) return cb(err)
    var target = u.expandTarget(header.bits)
    cb(null, hash.compare(target) !== 1)
  })
}

Blockchain.prototype.maxTarget = function () {
  return u.expandTarget(this.params.genesisHeader.bits)
}
