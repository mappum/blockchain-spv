var Readable = require('stream').Readable
var inherits = require('inherits')
var u = require('bitcoin-util')
require('setimmediate')

function HeaderStream (chain, opts) {
  if (!chain) throw new Error('"chain" argument is required')
  if (!(this instanceof HeaderStream)) return new HeaderStream(chain, opts)
  Readable.call(this, { objectMode: true })

  opts = opts || {}
  this.chain = chain
  this.cursor = opts.from || chain.genesis.hash
  this.stopHash = opts.stopHash
  this.stopHeight = opts.stopHeight
  this.inclusive = opts.inclusive

  this.paused = false
  this.ended = false
  this.skipped = false
  this.lastHash = u.nullHash
}
inherits(HeaderStream, Readable)

HeaderStream.prototype._read = function () {
  this._next()
}

HeaderStream.prototype._next = function () {
  if (this.paused || this.ended) return
  this.paused = true

  if (this.cursor.equals(u.nullHash)) {
    // we reached end of chain, wait for new block
    this.chain.once('block', (block) => {
      this.chain.getBlock(this.lastHash, (err, block) => {
        if (err) return this.emit('error', err)
        this.paused = false
        this.cursor = block.next
        setImmediate(this._next.bind(this))
      })
    })
    return
  }

  this.chain.getBlock(this.cursor, (err, block) => {
    if (this.ended) return
    if (err) return this.emit('error', err)
    this.cursor = block.next
    this.lastHash = block.header.getHash()
    this.paused = false
    var res = true
    if (this.inclusive != null && !this.inclusive && !this.skipped) {
      this.skipped = true
    } else {
      res = this.push(block)
    }
    if ((this.stopHash && this.stopHash.equals(this.lastHash)) ||
    (this.stopHeight && this.stopHeight === block.height)) {
      return this.push(null)
    }
    if (res) this._next()
  })
}

HeaderStream.prototype.end = function () {
  this.ended = true
  this.push(null)
}

module.exports = HeaderStream
