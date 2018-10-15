'use strict'

const u = require('bitcoin-util')
const { getHash } = require('../lib/blockchain.js')

const testMaxTarget = Buffer.from('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex')

function isValidProofOfWork (header) {
  let target = u.expandTarget(header.bits)
  let hash = getHash(header).reverse()
  return hash.compare(target) !== 1
}

function createHeader (prev, nonce, bits, validProof = true) {
  let i = nonce || 0
  let height = prev ? (prev.height + 1) : 0
  let header
  do {
    header = {
      height,
      version: 1,
      prevHash: prev ? getHash(prev) : u.nullHash,
      merkleRoot: u.nullHash,
      timestamp: prev ? (prev.timestamp + 600) : Math.floor(Date.now() / 1000),
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
  timestamp: Math.floor(Date.now() / 1000),
  bits: u.compressTarget(testMaxTarget),
  nonce: 0
}

function mine (chain, blocks, add = true) {
  let prev = chain.getByHeight(chain.height())
  let headers = []
  for (let i = 0; i < blocks; i++) {
    let header = createHeader(prev)
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
