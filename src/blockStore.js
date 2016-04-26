var EventEmitter = require('events').EventEmitter
var u = require('bitcoin-util')
var DefaultBlock = require('bitcoinjs-lib').Block
var inherits = require('inherits')
var reverse = require('buffer-reverse')
var struct = require('varstruct')
var varint = require('varuint-bitcoin')

var storedBlock = struct([
  { name: 'height', type: struct.UInt32LE },
  { name: 'header', type: struct.VarBuffer(varint) },
  { name: 'next', type: struct.Buffer(32) }
])

function encodeKey (hash) {
  if (Buffer.isBuffer(hash)) return hash.toString('base64')
  if (typeof hash === 'string') {
    if (hash.length !== 64) throw new Error('Invalid hash length')
    return reverse(new Buffer(hash, 'hex')).toString('base64')
  }
  throw new Error('Invalid hash')
}

var BlockStore = module.exports = function (opts) {
  if (!opts.db) {
    throw new Error('Must specify "db" option')
  }
  this.db = opts.db
  this.Block = opts.Block || DefaultBlock

  this.keyEncoding = 'utf8'
  this.valueEncoding = 'binary'
}
inherits(BlockStore, EventEmitter)

BlockStore.prototype.put = function (block, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (block.height == null) return cb(new Error('Must specify height'))
  if (block.header == null) return cb(new Error('Must specify header'))
  if (opts.tip) opts.best = true

  var blockEncoded = storedBlock.encode({
    height: block.height,
    header: block.header.toBuffer(),
    next: u.nullHash
  })
  var batch = [
    {
      type: 'put',
      key: encodeKey(block.header.getHash()),
      value: blockEncoded,
      keyEncoding: this.keyEncoding,
      valueEncoding: this.valueEncoding
    }
  ]
  if (opts.best && opts.prev) {
    var prevEncoded = storedBlock.encode({
      height: opts.prev.height,
      header: opts.prev.header.toBuffer(),
      next: block.header.getHash()
    })
    batch.push({
      type: 'put',
      key: encodeKey(opts.prev.header.getHash()),
      value: prevEncoded,
      keyEncoding: this.keyEncoding,
      valueEncoding: this.valueEncoding
    })
  }
  this.db.batch(batch, (err) => {
    if (err) return cb(err)
    if (opts.tip) {
      return this._setTip({ height: block.height, hash: block.header.getId() }, cb)
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
  }, (err, data) => {
    if (err) return cb(err)
    var block = storedBlock.decode(data)
    block.header = this.Block.fromBuffer(block.header)
    cb(null, block)
  })
}

BlockStore.prototype._setTip = function (tip, cb) {
  var newTip = {}
  for (var k in tip) newTip[k] = tip[k]
  delete newTip.header
  this.db.put('tip', newTip, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  }, cb)
}

BlockStore.prototype.getTip = function (cb) {
  var self = this
  this.db.get('tip', {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  }, (err, tip) => {
    if (err) return cb(err)
    self.get(tip.hash, (err, block) => {
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
