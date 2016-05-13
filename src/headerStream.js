'use strict'

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
  this.start = this.cursor = opts.from || chain.genesis.hash
  this.stopHash = opts.stopHash
  this.stopHeight = opts.stopHeight

  this.paused = false
  this.ended = false
  this.first = true
  this.lastHash = u.nullHash
  this.lastBlock = null
}
inherits(HeaderStream, Readable)

HeaderStream.prototype._read = function () {
  this._next()
}

HeaderStream.prototype._next = function () {
  if (this.paused || this.ended) return
  this.paused = true

  // we reached end of chain, wait for new tip
  if (!this.cursor) {
    this.chain.once('tip', (block) => {
      this.chain.getPath(this.lastBlock, block, (err, path) => {
        if (err) return this.emit('error', err)
          // reorg handling (remove blocks to get to new fork)
        for (let block of path.remove) {
          block.operation = 'remove'
          this.push(block)
        }
        for (let block of path.add) {
          block.operation = 'add'
          this.push(block)
        }
        this.paused = false
        this.cursor = block.next
        setImmediate(this._next.bind(this))
      })
    })
    return
  }

  // stream headers that are already stored
  this.chain.getBlock(this.cursor, (err, block) => {
    if (this.ended) return
    if (err) return this.emit('error', err)
    if (!block) {
      // if current "next" block is not found
      if (this.cursor.equals(this.start)) {
        // if this is the `from` block, wait until we see the block
        this.chain.once(`header:${this.cursor.toString('base64')}`,
          this._next.bind(this))
      } else {
        this.emit('error', new Error('HeaderStream error: chain should ' +
          `continue to block "${this.cursor.toString('hex')}", but it was ` +
          'not found in the BlockStore'))
      }
      return
    }
    this.cursor = block.next
    this.lastHash = block.header.getHash()
    this.lastBlock = block
    this.paused = false
    var res = true
    if (this.first) {
      this.first = false
    } else {
      block.operation = 'add'
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
