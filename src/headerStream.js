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

  this.paused = false
  this.ended = false
  this.first = true
  if (!opts.from || opts.from.equals(u.nullHash)) {
    this.first = false
  }
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
        this._pushPath(path)
        this.paused = false
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

    // when starting, ensure we are on the best chain
    if (this.first) {
      let done = () => {
        this.paused = false
        this.first = false
        setImmediate(this._next.bind(this))
      }
      this.chain.getBlockAtHeight(block.height, (err, bestChainBlock) => {
        if (err) return this.emit('error', err)
        if (block.header.getHash().equals(bestChainBlock.header.getHash())) {
          // we are already on the best chain, continue like normal
          this.cursor = block.next
          this.lastHash = block.header.getHash()
          this.lastBlock = block
          return done()
        }
        // we need to add/remove some blocks to get to the best chain
        this.chain.getPath(block, bestChainBlock, (err, path) => {
          if (err) return this.emit('error', err)
          this._pushPath(path)
          done()
        })
      })
      return
    }

    // we have the cursor block, so push it and continue
    this.paused = false
    block.add = true
    var res = this._push(block)
    if (res) this._next()
  })
}

HeaderStream.prototype._push = function (block) {
  if (this.ended) return
  this.cursor = block.next
  this.lastHash = block.header.getHash()
  this.lastBlock = block
  return this.push(block)
}

HeaderStream.prototype._pushPath = function (path) {
  for (let block of path.remove) {
    block.add = false
    this._push(block)
  }
  for (let block of path.add) {
    block.add = true
    this._push(block)
  }
}

HeaderStream.prototype.end = function () {
  this.ended = true
  this.push(null)
}

module.exports = HeaderStream
