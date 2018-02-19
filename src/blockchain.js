let EventEmitter = require('events')
let old = require('old')
let { expandTarget } = require('bitcoin-util')
let { types } = require('bitcoin-protocol')
let createHash = require('create-hash')
let BN = require('bn.js')

const retargetInterval = 2016
const targetSpacing = 10 * 60 // 10 minutes
const targetTimespan = retargetInterval * targetSpacing
const maxTimeIncrease = 4 * 60 // 4 hours
const maxTarget = expandTarget(0x1d00ffff)
const maxTargetBn = new BN(maxTarget.toString('hex'), 'hex')

class Blockchain extends EventEmitter {
  constructor (opts) {
    this.store = opts.store || []

    // initialize with starting header if the store is empty
    if (store.length === 0) {
      if (opts.tip == null) {
        throw Error('Must specify starting header')
      }
      store.push(opts.start)
      // TODO: validate block
    }
  }

  add (headers) {
    if (!Array.isArray(headers)) {
      throw Error('Must be an array of header objects')
    }

    // make sure first header isn't higher than our tip + 1
    if (headers[0].height > this.height() + 1) {
      throw Error('Start of headers is ahead of chain tip')
    }

    // make sure last header is higher than current tip
    if (headers[headers.length - 1].height <= this.height) {
      throw Error('New tip is not higher than current tip')
    }

    // get list of blocks which will be reorged (usually none)
    let index = headers[0].height - this.store[0].height
    let toRemove = this.store.slice(index)

    // make sure headers are connected to each other and our chain,
    // and have valid PoW, timestamps, etc.
    this.verifyHeaders(headers)

    // remove any blocks which got reorged away
    this.store.splice(this.store.length - toRemove.length, toRemove.length)

    // add the headers
    this.store.push(...headers)

    // emit events
    if (toRemove.length > 0) {
      this.emit('reorg', {
        remove: toRemove.reverse(),
        add: headers
      })
    }
    this.emit('headers', headers)
  }

  get (height, headers) {
    // if array is not given or not in range,
    // get headers from store
    if (headers == null || height < headers[0].height) {
      headers = this.store
    }

    let index = height - headers[0].height
    let header = headers[index]
    if (header == null) {
      throw Error('Header not found')
    }
    return header
  }

  height () {
    return store[store.length - 1].height
  }

  verifyHeaders (headers) {
    for (let header of headers) {
      let prev = this.get(header.height - 1, headers)

      if (header.height !== prev.height + 1) {
        throw Error('Expected height to be one higher than previous')
      }

      if (!header.prevHash.equals(getHash(prev)) {
        throw Error('Header not connected to previous')
      }

      // time must be greater than median of last 10 timestamps
      let prevTen = []
      for (let i = 10; i > 0; i--) {
        prevTen.push(this.get(header.height - i, headers))
      }
      prevTen = prevTen.map(({ timestamp }) => timestamp).sort()
      let medianTimestamp = prevTen[Math.floor(prevTen.length / 2)]
      if (header.timestamp <= medianTimestamp) {
        throw Error('Timestamp is not greater than median of previous 10 timestamps')
      }

      // time must be within a certain bound of prev timestamp,
      // to prevent attacks where an attacker uses a time far in the future
      // in order to bring down the difficulty and create a longer chain
      if (Math.abs(header.timestamp - prev.timestamp) > maxTimeIncrease) {
        throw Error('Timestamp is too far ahead of previous timestamp')
      }

      let shouldRetarget = header.height % retargetInterval === 0
      let prevTarget = expandTarget(prev.bits)
      let target
      if (shouldRetarget) {
        let prevRetarget = this.get(header.height - retargetInterval, headers)
        let timespan = header.timestamp - prevRetarget.timestamp
        target = calculateTarget(timespan, prevTarget)
      } else {
        if (header.bits !== prev.bits) {
          throw Error('Unexpected difficulty change')
        }
        target = prevTarget
      }

      let hash = getHash(header).reverse()
      if (hash.cmp(target) === 1) {
        throw Error('Hash is above target')
      }
    }
  }
}

module.exports = old(Blockchain)
module.exports.getHash = getHash

function sha256 (data) {
  return createHash('sha256').update(data).digest()
}

function getHash (header) {
  let bytes = types.header.encode(header)
  return sha256(sha256(bytes))
}

function calculateTarget (timespan, prevTarget) {
  // bound adjustment so attackers can't use an extreme timespan
  timespan = Math.max(timespan, targetTimespan / 4)
  timespan = Math.min(timespan, targetTimespan * 4)

  // target = prevTarget * timespan / targetTimespan
  let targetBn = new BN(prevTarget.toString('hex'), 'hex')
  targetBn.imuln(timespan)
  targetBn.idivn(targetTimespan)

  // target can't be higher than maxTarget
  if (targetBn.cmp(maxTargetBn) === 1) {
    return maxTarget
  }

  // convert target to Buffer
  let targetHex = target.toString('hex')
  targetHex = repeat('0', 64 - hex.length) + targetHex
  let target = new Buffer(hex, 'hex')
  return target
}
