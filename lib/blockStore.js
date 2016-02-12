var EventEmitter = require('events').EventEmitter
var util = require('util')
var u = require('bitcoin-util')
var Block = require('bitcoinjs-lib').Block
var buffertools
try {
  buffertools = require('buffertools')
} catch (err) {
  buffertools = require('browserify-buffertools')
}

function cloneBuffer (a) {
  var b = new Buffer(a.length)
  a.copy(b)
  return b
}

function encodeKey (hash) {
  if (Buffer.isBuffer(hash)) return buffertools.reverse(cloneBuffer(hash)).toString('base64')
  if (typeof hash === 'string') {
    if (hash.length === 44) return hash
    if (hash.length === 64) return new Buffer(hash, 'hex').toString('base64')
  }
  throw new Error('Invalid hash format')
}

var BlockStore = module.exports = function (opts) {
  if (!opts.db) {
    throw new Error('Must specify "db" option')
  }
  this.db = opts.db

  this.keyEncoding = 'utf8'
  this.valueEncoding = 'json'
}
util.inherits(BlockStore, EventEmitter)

BlockStore.prototype.put = function (block, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (block.height == null) return cb(new Error('Must specify height'))
  if (block.header == null) return cb(new Error('Must specify header'))
  if (opts.tip) opts.best = true

  var self = this
  var blockJson = {
    height: block.height,
    header: block.header.toBuffer().toString('base64')
  }
  var batch = [
    {
      type: 'put',
      key: encodeKey(block.header.getHash()),
      value: blockJson,
      keyEncoding: this.keyEncoding,
      valueEncoding: this.valueEncoding
    }
  ]
  if (opts.best && opts.prev) {
    var prevJson = {
      height: opts.prev.height,
      header: opts.prev.header.toBuffer().toString('base64'),
      next: block.header.getId()
    }
    batch.push({
      type: 'put',
      key: encodeKey(opts.prev.header.getHash()),
      value: prevJson,
      keyEncoding: this.keyEncoding,
      valueEncoding: this.valueEncoding
    })
  }
  this.db.batch(batch, function (err) {
    if (err) return cb(err)
    if (opts.tip) {
      return self._setTip({ height: block.height, hash: block.header.getId() }, cb)
    }
    cb(null)
  })
}

BlockStore.prototype.get = function (hash, cb) {
  try {
    var key = encodeKey(hash)
  } catch (err) {
    return cb(err)
  }

  this.db.get(key, {
    keyEncoding: this.keyEncoding,
    valueEncoding: this.valueEncoding
  }, function (err, block) {
    if (err) return cb(err)
    var header = new Buffer(block.header, 'base64')
    block.header = Block.fromBuffer(header)
    cb(null, block)
  })
}

BlockStore.prototype._setTip = function (tip, cb) {
  var newTip = {}
  for (var k in tip) newTip[k] = tip[k]
  delete newTip.header
  this.db.put('tip', newTip, cb)
}

BlockStore.prototype.getTip = function (cb) {
  var self = this
  this.db.get('tip', {
    keyEncoding: 'utf8',
    valueEncoding: this.valueEncoding
  }, function (err, tip) {
    if (err) return cb(err)
    self.get(tip.hash, {
      keyEncoding: this.keyEncoding,
      valueEncoding: this.valueEncoding
    }, function (err, block) {
      if (err) return cb(err)
      tip.hash = u.toHash(tip.hash)
      tip.header = block.header
      cb(null, tip)
    })
  })
}

BlockStore.prototype.close = function (cb) {
  this.db.close(cb)
}

BlockStore.prototype.isClosed = function () {
  return this.db.isClosed()
}

BlockStore.prototype.isOpen = function () {
  return this.db.isOpen()
}
