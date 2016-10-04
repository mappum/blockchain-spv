var EventEmitter = require('events').EventEmitter
var u = require('bitcoin-util')
var DefaultBlock = require('bitcoinjs-lib').Block
var inherits = require('inherits')
var reverse = require('buffer-reverse')
var struct = require('varstruct')
var varint = require('varuint-bitcoin')
var transaction = require('level-transactions')
require('setimmediate')

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

var TX_TTL = 20 * 1000

var BlockStore = module.exports = function (opts) {
  if (!opts.db) {
    throw new Error('Must specify "db" option')
  }
  this.db = opts.db
  this.tx = null
  this.txTimeout = null
  this.committing = false
  this.Block = opts.Block || DefaultBlock
  this.indexInterval = opts.indexInterval

  this.keyEncoding = 'utf8'
  this.valueEncoding = 'binary'
  this.dbOpts = {
    keyEncoding: this.keyEncoding,
    valueEncoding: this.valueEncoding
  }
}
inherits(BlockStore, EventEmitter)

BlockStore.prototype.commit = function (cb) {
  cb = cb || ((err) => { if (err) this.emit('error', err) })
  var oldTx = this.tx
  this.tx = null
  if (this.txTimeout) clearTimeout(this.txTimeout)
  if (oldTx) {
    this.committing = true
    oldTx.commit((err) => {
      this.committing = false
      this.emit('commit')
      cb(err)
    })
  } else {
    cb(null)
  }
}

BlockStore.prototype._createTx = function () {
  if (this.tx) throw new Error('A db transaction already exists')
  this.tx = transaction(this.db, { ttl: TX_TTL * 2 })
  this.txTimeout = setTimeout(this.commit.bind(this), TX_TTL)
  if (this.txTimeout.unref) this.txTimeout.unref()
  return this.tx
}

BlockStore.prototype.put = function (block, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (this.isClosed()) return cb(new Error('Database is not open'))
  if (block.height == null) return cb(new Error('Must specify height'))
  if (block.header == null) return cb(new Error('Must specify header'))
  if (opts.tip) opts.best = true
  if (opts.best) opts.link = true
  if (opts.commit) {
    let _cb = cb
    cb = (err) => {
      if (err) return _cb(err)
      this.commit(_cb)
    }
  }

  var tx = this.tx || this._createTx()

  var blockEncoded = storedBlock.encode({
    height: block.height,
    header: block.header.toBuffer(),
    next: u.nullHash
  })
  var hash = block.header.getHash()
  tx.put(encodeKey(hash), blockEncoded, this.dbOpts)

  if (opts.link && opts.prev) {
    var prevEncoded = storedBlock.encode({
      height: opts.prev.height,
      header: opts.prev.header.toBuffer(),
      next: block.header.getHash()
    })
    tx.put(encodeKey(opts.prev.header.getHash()),
      prevEncoded, this.dbOpts)
  }

  if (block.height % this.indexInterval === 0) {
    tx.put(block.height.toString(), hash, this.dbOpts)
  }

  if (opts.tip) {
    this._setTip({ height: block.height, hash: block.header.getId() }, cb)
  } else {
    cb(null)
  }
}

BlockStore.prototype.get = function (hash, cb) {
  if (this.isClosed()) return cb(new Error('Database is not open'))
  if (this.committing) {
    this.once('commit', () => this.get(hash, cb))
    return
  }

  try {
    var key = encodeKey(hash)
  } catch (err) {
    return cb(err)
  }

  var db = this.tx || this.db
  db.get(key, this.dbOpts, (err, data) => {
    if (err) return cb(err)
    setImmediate(() => {
      var block = storedBlock.decode(data)
      block.header = this.Block.fromBuffer(block.header)
      if (block.next.equals(u.nullHash)) block.next = null
      cb(null, block)
    })
  })
}

BlockStore.prototype.getIndex = function (height, cb) {
  if (this.committing) {
    this.once('commit', () => this.getTip(cb))
    return
  }
  var interval = this.indexInterval
  // we use floor instead of round because we might have not yet
  // synced to the larger height (ceil)
  var indexHeight = Math.floor(height / interval) * interval
  var db = this.tx || this.db
  db.get(indexHeight.toString(), this.dbOpts, cb)
}

BlockStore.prototype._setTip = function (tip, cb) {
  var newTip = {}
  for (var k in tip) newTip[k] = tip[k]
  delete newTip.header
  this.tx.put('tip', newTip, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  }, cb)
}

BlockStore.prototype.getTip = function (cb) {
  var self = this
  if (this.committing) {
    this.once('commit', () => this.getTip(cb))
    return
  }
  var db = this.tx || this.db
  db.get('tip', {
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
  if (this.isClosed()) return cb(null)
  this.commit(() => this.db.close(cb))
}

BlockStore.prototype.isClosed = function () {
  return this.db.isClosed()
}

BlockStore.prototype.isOpen = function () {
  return this.db.isOpen()
}
