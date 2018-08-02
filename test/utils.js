'use strict'

const u = require('bitcoin-util')
const params = require('webcoin-bitcoin').blockchain

exports.createBlock = function (prev, nonce, bits, validProof) {
  var i = nonce || 0
  validProof = validProof == null ? true : validProof
  var header
  do {
    header = {
      version: 1,
      prevHash: prev ? prev.getHash() : u.nullHash,
      merkleRoot: u.nullHash,
      timestamp: prev ? (prev.timestamp + 1) : Math.floor(Date.now() / 1000),
      bits: bits || (prev ? prev.bits : u.compressTarget(exports.maxTarget)),
      nonce: i++
    }
  } while (validProof !== exports.validProofOfWork(header))
  return header
}

exports.maxTarget = new Buffer('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex')

exports.validProofOfWork = function (header) {
  var target = u.expandTarget(header.bits)
  var hash = header.getHash().reverse()
  return hash.compare(target) !== 1
}

exports.createBlock = function (prev, nonce, bits, validProof) {
  var i = nonce || 0
  validProof = validProof == null ? true : validProof
  var header
  do {
    header = {
      version: 1,
      prevHash: prev ? prev.getHash() : u.nullHash,
      merkleRoot: u.nullHash,
      timestamp: prev ? (prev.timestamp + 1) : Math.floor(Date.now() / 1000),
      bits: bits || (prev ? prev.bits : u.compressTarget(exports.maxTarget)),
      nonce: i++
    }
  } while (validProof !== exports.validProofOfWork(header))
  return header
}

var defaultTestParams = {
  genesisHeader: {
    version: 1,
    prevHash: u.nullHash,
    merkleRoot: u.nullHash,
    timestamp: Math.floor(Date.now() / 1000),
    bits: u.compressTarget(exports.maxTarget),
    nonce: 0
  },
  checkpoints: null
}

exports.createTestParams = function (opts) {
  return Object.assign({}, params, defaultTestParams, opts)
}
