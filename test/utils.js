'use strict'

const u = require('bitcoin-util')
const BN = require('bn.js')
const { getHash, calculateTarget } = require('../src/blockchain.js')

const testMaxTarget = Buffer.from('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex')
const testMaxTargetBn = new BN(testMaxTarget.toString('hex'), 'hex')

function isValidProofOfWork (header) {
  let target = u.expandTarget(header.bits)
  let hash = getHash(header).reverse()
  return hash.compare(target) !== 1
}

function createHeader (prev, nonce, bits, validProof = true, timeSpacing = 600) {
  let i = nonce || Math.floor(Math.random() * 10e6)
  let height = prev ? (prev.height + 1) : 0
  let header
  do {
    header = {
      height,
      version: 1,
      prevHash: prev ? getHash(prev) : u.nullHash,
      merkleRoot: u.nullHash,
      timestamp: prev ? (prev.timestamp + timeSpacing) : Math.floor(Date.now() / 1000),
      bits: bits || (prev ? prev.bits : u.compressTarget(testMaxTarget)),
      nonce: i++
    }
  } while (validProof !== isValidProofOfWork(header))
  return header
}

const testGenesis = {
  height: 0,
  version: 1,
  prevHash: u.nullHash,
  merkleRoot: u.nullHash,
  timestamp: 10000,
  bits: u.compressTarget(testMaxTarget),
  nonce: 0
}

function mine (chain, blocks, add = true, timeSpacing = 600) {
  let prev = chain.getByHeight(chain.height())
  let headers = []
  for (let i = 0; i < blocks; i++) {
    let bits
    if ((prev.height + 1) % 2016 === 0) {
      let timespan = timeSpacing * 2016
      let prevTarget = u.expandTarget(prev.bits)
      let target = calculateTarget(timespan, prevTarget, testMaxTarget, testMaxTargetBn)
      bits = u.compressTarget(target)
    }
    let header = createHeader(prev, null, bits, true, timeSpacing)
    headers.push(header)
    prev = header
  }
  if (add) {
    chain.add(headers)
  }
  return headers
}

module.exports = {
  testGenesis,
  testMaxTarget,
  createHeader,
  isValidProofOfWork,
  mine
}
