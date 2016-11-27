var EventEmitter = require('events').EventEmitter
var async = require('async')
var u = require('bitcoin-util')
var DefaultBlock = require('bitcoinjs-lib').Block
var from = require('from2').obj
var to = require('flush-write-stream').obj
var inherits = require('inherits')
var BlockStore = require('./blockStore.js')
var HeaderStream = require('./headerStream.js')
var assign = require('object-assign')
if (!setImmediate) require('setimmediate')

var storeClosedError = new Error('Store is closed')

function validParameters (params) {
  return typeof params.genesisHeader === 'object' &&
    typeof params.shouldRetarget === 'function' &&
    typeof params.calculateTarget === 'function' &&
    typeof params.miningHash === 'function'
}

var Blockchain = module.exports = function (params, db, opts) {
  if (!(this instanceof Blockchain)) return new Blockchain(params, db, opts)
  if (!params || !validParameters(params)) {
    throw new Error('Invalid blockchain parameters')
  }
  if (!db) throw new Error('Must specify db')
  this.params = params
  opts = opts || {}

  var Block = params.Block || DefaultBlock

  function blockFromObject (obj) {
    return assign(new Block(), obj)
  }

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

  this.ready = false
  this.closed = false
  this.adding = false

  var indexInterval = params.interval
  this.store = new BlockStore({ db, Block, indexInterval })
  this._initialize()
}
inherits(Blockchain, EventEmitter)

Blockchain.prototype._initialize = function () {
  if (this.ready) {
    return this._error(new Error('Already initialized'))
  }

  this._initStore((err) => {
    if (err) return this._error(err)
    this.store.getTip((err, tip) => {
      if (err && err.name !== 'NotFoundError') return this._error(err)
      if (tip) this.tip = tip
      this.ready = true
      this.emit('ready')
    })
  })
}

Blockchain.prototype._initStore = function (cb) {
  var putIfNotFound = (block) => (cb) => {
    this.store.get(block.hash, (err) => {
      if (err && !err.notFound) return cb(err)
      if (!err) return cb()
      if (this.closed || this.store.isClosed()) return cb(storeClosedError)
      this.store.put(block, { commit: true, best: true }, cb)
    })
  }

  var tasks = [ putIfNotFound(this.genesis) ]
  if (this.checkpoint) tasks.push(putIfNotFound(this.checkpoint))
  async.parallel(tasks, cb)
}

Blockchain.prototype.onceReady = function (cb) {
  if (this.ready) return cb()
  this.once('ready', cb)
}

Blockchain.prototype.close = function (cb) {
  this.onceReady(() => {
    this.closed = true
    this.store.close(cb)
  })
}

Blockchain.prototype.getTip = function () {
  return this.tip
}

Blockchain.prototype.getPath = function (from, to, cb) {
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

  var addTraversedBlock = (block) => {
    if (down &&
    block.header.getHash().compare(to.header.getHash()) !== 0) {
      output.remove.push(block)
    } else if (!down &&
    block.header.getHash().compare(from.header.getHash()) !== 0) {
      output.add.unshift(block)
    }
  }

  // traverse down from the higher block to the lower block
  var traverseDown = (err, block) => {
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
    this.getBlock(block.header.prevHash, traverseDown)
  }

  // traverse down from both blocks until we find one block that is the same
  var traverseToFork = (left, right) => {
    if (left.height === 0 || right.height === 0) {
      // we got all the way to two different genesis blocks,
      // the blocks don't have a path between them
      return cb(new Error('Blocks are not in the same chain'))
    }

    output.remove.push(down ? left : right)
    output.add.unshift(down ? right : left)

    this.getBlock(left.header.prevHash, (err, left) => {
      if (err) return cb(err)
      this.getBlock(right.header.prevHash, (err, right) => {
        if (err) return cb(err)
        if (left.header.getHash().compare(right.header.getHash()) === 0) {
          output.fork = left
          return cb(null, output)
        }
        traverseToFork(left, right)
      })
    })
  }
  traverseDown(null, top)
}

Blockchain.prototype.getPathToTip = function (from, cb) {
  this.getPath(from, this.tip, cb)
}

Blockchain.prototype.getBlock = function (hash, cb) {
  if (!Buffer.isBuffer(hash)) {
    return cb(new Error('"hash" must be a Buffer'))
  }
  this.onceReady(() => this.store.get(hash, cb))
}

Blockchain.prototype.getBlockAtTime = function (time, cb) {
  var output = this.tip
  var traverse = (err, block) => {
    if (err) return cb(err)
    if (block.header.timestamp <= time) return cb(null, output)
    if (block.header.timestamp >= time) output = block
    if (block.height === 0) return cb(null, output)
    this.getBlock(block.header.prevHash, traverse)
  }
  traverse(null, this.tip)
}

Blockchain.prototype.getBlockAtHeight = function (height, cb) {
  if (height > this.tip.height) return cb(new Error('height is higher than tip'))
  if (height < 0) return cb(new Error('height must be >= 0'))

  this.store.getIndex(height, (err, indexHash) => {
    if (err) return cb(err)

    var traverse = (err, block) => {
      if (err) return cb(err)
      if (block.height === height) return cb(null, block)
      this.getBlock(block.next, traverse)
    }
    this.getBlock(indexHash, traverse)
  })
}

Blockchain.prototype.getLocator = function (from, cb) {
  if (typeof from === 'function') {
    cb = from
    from = this.tip.hash
  }
  var locator = []
  var getBlock = (from) => {
    this.getBlock(from, (err, block) => {
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
  if (!err) return
  this.emit('error', err)
}

Blockchain.prototype._put = function (hash, opts, cb) {
  this.onceReady(() => this.store.put(hash, opts, cb))
}

Blockchain.prototype.createWriteStream = function () {
  return to({ highWaterMark: 4 }, (headers, enc, cb) => {
    this.addHeaders(headers, cb)
  })
}

Blockchain.prototype.createReadStream = function (opts) {
  return new HeaderStream(this, opts)
}

Blockchain.prototype.createLocatorStream = function (opts) {
  var changed = true
  var getting = false
  var pushLocator = (cb) => {
    changed = false
    this.getLocator((err, locator) => {
      if (err) return cb(err)
      getting = false
      cb(null, locator)
    })
  }
  this.on('consumed', () => { changed = true })
  return from((size, next) => {
    if (getting) return
    getting = true
    if (changed) return pushLocator(next)
    this.once('consumed', () => pushLocator(next))
  })
}

Blockchain.prototype.addHeaders = function (headers, cb) {
  if (this.adding) return cb(new Error('Already adding headers'))

  var previousTip = this.tip
  this.adding = true
  var done = (err, last) => {
    this.emit('consumed')
    if (err) this.emit('headerError', err)
    else this.emit('headers', headers)
    this.adding = false
    this.store.commit((err2) => {
      if (err || err2) return cb(err || err2)
      this.emit('commit', headers)
      cb(null, last)
    })
  }

  this.getBlock(headers[0].prevHash, (err, start) => {
    if (err && err.notFound) {
      return done(new Error('Block does not connect to chain'))
    }
    if (err) return done(err)
    start.hash = start.header.getHash()

    async.reduce(headers, start, this._addHeader.bind(this), (err, last) => {
      if (err) return done(err, last)

      // TODO: add even if it doesn't pass the current tip
      // (makes us store orphan forks, and lets us handle reorgs > 2000 blocks)

      if (last.height > previousTip.height) {
        this.getPath(previousTip, last, (err, path) => {
          if (err) return done(err, last)
          if (path.remove.length > 0) {
            this._reorg(path, done)
            return
          }
          done(null, last)
        })
        return
      }

      done(null, last)
    })
  })
}

Blockchain.prototype._reorg = function (path, cb) {
  // wait for db to finish committing if neccessary
  if (this.store.committing) {
    this.store.once('commit', () => this._reorg(path, cb))
    return
  }

  // create new db transaction if there isn't one
  if (!this.store.tx) this.store.createTx(false)

  // iterate through the new best fork, and put the blocks again
  // (this updates the links, height index, and tip)
  var put = (prev, i = 0) => {
    if (i === path.add.length) {
      this.emit('reorg', { path, tip: prev })
      return cb(null, prev)
    }
    var block = path.add[i]
    this.store.put(block, {
      best: true,
      tip: i === path.add.length - 1,
      prev
    }, (err) => {
      if (err) return cb(err)
      put(block, i + 1)
    })
  }
  put(path.fork)
}

Blockchain.prototype._addHeader = function (prev, header, cb) {
  var height = prev.height + 1
  var block = {
    height: height,
    hash: header.getHash(),
    header: header
  }
  // if prev already has a "next" pointer, then this is a fork, so we
  // won't change it to point to this block (yet)
  var link = !prev.next

  var put = () => {
    var tip = height > this.tip.height
    this._put({ header: header, height: height }, { tip: tip, prev: prev, link: link }, (err) => {
      if (err) return cb(err)
      this.emit('block', block)
      this.emit(`block:${block.hash.toString('base64')}`, block)
      if (tip) {
        this.tip = block
        this.emit('tip', block)
      }
      cb(null, block)
    })
  }

  if (header.prevHash.compare(prev.hash) !== 0) {
    return cb(new Error('Block does not connect to previous'), block)
  }
  this.params.shouldRetarget(block, (err, retarget) => {
    if (err) return cb(err)
    if (!retarget && header.bits !== prev.header.bits) {
      return cb(new Error('Unexpected difficulty change at height ' + height), block)
    }
    this.validProof(header, (err, validProof) => {
      if (err) return cb(err)
      if (!validProof) {
        return cb(new Error('Mining hash is above target. ' +
          'Hash: ' + header.getId() + ', ' +
          'Target: ' + u.expandTarget(header.bits).toString('hex') + ')'), block)
      }
      // TODO: other checks (timestamp, version)
      if (retarget) {
        return this.params.calculateTarget(block, this, (err, target) => {
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
}

Blockchain.prototype.validProof = function (header, cb) {
  this.params.miningHash(header, (err, hash) => {
    if (err) return cb(err)
    var target = u.expandTarget(header.bits)
    cb(null, hash.compare(target) !== 1)
  })
}

Blockchain.prototype.maxTarget = function () {
  return u.expandTarget(this.params.genesisHeader.bits)
}

Blockchain.prototype.estimatedChainHeight = function () {
  var elapsed = (Date.now() / 1000) - this.tip.header.timestamp
  var blocks = Math.round(elapsed / this.params.targetSpacing)
  return this.tip.height + blocks
}
