var EventEmitter = require('events').EventEmitter
var util = require('util')
var async = require('async')
var bitcore = require('bitcore-lib')
var u = require('bitcoin-util')
var BlockStore = require('./blockStore.js')

if (process.browser) {
  require('setimmediate')
}

function noop () {}

var storeClosedError = new Error('Store is closed')

function validParameters (params) {
  return typeof params.genesisHeader === 'object' &&
    typeof params.shouldRetarget === 'function' &&
    typeof params.calculateTarget === 'function' &&
    typeof params.miningHash === 'function'
}

var Blockchain = module.exports = function (params, db) {
  var self = this

  if (!params || !validParameters(params)) {
    throw new Error('Invalid network parameters')
  }
  this.params = params

  if (!db) throw new Error('Must specify db')

  var genesisHeader = new bitcore.BlockHeader(params.genesisHeader)
  this.genesis = this.tip = {
    height: 0,
    hash: u.toHash(genesisHeader.hash),
    header: genesisHeader
  }

  if (params.checkpoints) {
    var lastCheckpoint = params.checkpoints[params.checkpoints.length - 1]
    this.checkpoint = {
      height: lastCheckpoint.height,
      header: new bitcore.BlockHeader(lastCheckpoint.header)
    }
    this.checkpoint.hash = u.toHash(this.checkpoint.header.hash)
    this.tip = this.checkpoint
  }

  this.initialized = false
  this.closed = false

  this.store = new BlockStore({ db: db })
  this._initStore(function (err) {
    if (err && err !== storeClosedError) return self._error(err)
    else if (err && err === storeClosedError) return
    self.initialized = true
    self.emit('ready')
  })
}
util.inherits(Blockchain, EventEmitter)

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

Blockchain.prototype.waitForReady = function (cb) {
  if (this.initialized) return cb()
  this.on('ready', cb)
}

Blockchain.prototype.close = function (cb) {
  var self = this
  this.waitForReady(function () {
    self.closed = true
    self.syncing = false
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
    if (down && block.header.hash !== to.header.hash) output.remove.push(block)
    else if (!down && block.header.hash !== from.header.hash) output.add.unshift(block)
  }

  // traverse down from the higher block to the lower block
  function traverseDown (err, block) {
    if (err) return cb(err)
    if (block.height === bottom.height) {
      // we traversed down to the lower height
      if (block.header.hash === bottom.header.hash) {
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
        if (left.header.hash === right.header.hash) {
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
    if (block.header.time <= time) return cb(null, output)
    if (block.header.time >= time) output = block
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
  this.getBlock(from, function (err, block) {
    if (err) return cb(err)
    // TODO: include some previous blocks in case we are on a fork
    return cb(null, [ u.toHash(block.header.hash) ])
  })
}

Blockchain.prototype._error = function (err) {
  this.emit('error', err)
}

Blockchain.prototype._initialize = function (cb) {
  cb = cb || noop

  if (this.initialized) return cb(null)

  var self = this
  this.store.getTip(function (err, tip) {
    self.initialized = true
    if (err && err.name === 'NotFoundError') return cb(null)
    if (err) return cb(err)
    self.tip = tip
    cb(null, tip)
  })
}

Blockchain.prototype._put = function (hash, opts, cb) {
  var self = this
  if (!this.initialized) {
    this.once('ready', function () { self._put(hash, opts, cb) })
    return
  }
  this.store.put(hash, opts, cb)
}

Blockchain.prototype.addHeaders = function (headers, cb) {
  var self = this

  var previousTip = this.tip

  this.getBlock(headers[0].prevHash, function (err, start) {
    if (err && err.name === 'NotFoundError') return cb(new Error('Block does not connect to chain'))
    if (err) return cb(err)
    start.hash = u.toHash(start.header.hash)

    async.reduce(headers, start, self._addHeader.bind(self), function (err, last) {
      if (err) return cb(err, last)

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
  if (!cb) cb = typeof header === 'function' ? header : cb
  if (prev instanceof bitcore.BlockHeader) {
    header = prev
    prev = this.tip
  }

  var self = this
  var height = prev.height + 1
  var block = {
    height: height,
    hash: u.toHash(header.hash),
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
        return cb(new Error('Mining hash is above target'), block)
      }
      // TODO: other checks (timestamp, version)
      if (retarget) {
        return self.params.calculateTarget(block, self, function (err, target) {
          if (err) return cb(err, block)

          var expected = u.compressTarget(target)
          if (expected !== header.bits) {
            return cb(new Error('Bits in block (' + header.bits.toString(16) + ')' +
              ' is different than expected (' + expected.toString(16) + ')'))
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
        block.syncing = self.syncing
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
