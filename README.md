# blockchain-spv

[![npm version](https://img.shields.io/npm/v/blockchain-spv.svg)](https://www.npmjs.com/package/blockchain-spv)
[![Build Status](https://travis-ci.org/mappum/blockchain-spv.svg?branch=master)](https://travis-ci.org/mappum/blockchain-spv)
[![Dependency Status](https://david-dm.org/mappum/blockchain-spv.svg)](https://david-dm.org/mappum/blockchain-spv)

**Stores blockchain headers and verifies transactions with SPV**

## Usage

`npm install blockchain-spv`

```js
// import blockchain parameters for Bitcoin
var params = require('webcoin-bitcoin').blockchain

// create a LevelUp database where the block data should be stored
var db = levelup('bitcoin.chain', { db: require('memdown') })

// create blockchain
var Blockchain = require('blockchain-spv')
var chain = new Blockchain(params, db)
```

`Blockchain` stores and verifies block headers, and does SPV (lite client) verification. It is compatible with Bitcoin and Bitcoin-derived blockchains.

----
#### `new Blockchain(params, db)`

Creates an SPV `Blockchain` which stores and verifies block headers.

`params` should be the blockchain parameters for the blockchain you wish to use. Parameters for Bitcoin are available at `require('webcoin-bitcoin').blockchain`. For more info about params you can use, see the [Parameters](#parameters) section.

`db` should be a [`LevelUp`](https://github.com/Level/levelup) instance where block data will be stored. The db should not be shared with another Blockchain (if you need to, use [`level-sublevel`](https://github.com/dominictarr/level-sublevel) to create a sub-section of your db).

----
#### `chain.addHeaders(headers, callback)`

Adds block headers to the chain. `headers` should be an array of contiguous, ascending block headers. The headers will be verified (checked to make sure the expected amount of work was done, the difficulty was correct, etc.). The callback will be called with `cb(err, header)` where `header` is an invalid header if there was a validation error.

----
#### `chain.getBlock(hash, callback)`

Gets a block in the chain with hash `hash`. `hash` must be a Buffer. The callback is called with `cb(err, block)`.

----
#### `chain.getBlockAtHeight(height, callback)`

Gets a block in the chain with height `height`. The callback is called with `cb(err, block)`.

Note that this requires the blockchain to be traversed (from the tip or genesis block, whichever is closest), so it runs in `O(N)` time.

----
#### `chain.getBlockAtTime(timestamp, callback)`

Gets the highest block with a timestamp that comes before or on `timestamp`. `timestamp` should be in [Unix time](https://en.wikipedia.org/wiki/Unix_time) measured in seconds (not milliseconds as returned by `Date.now()`). The callback is called with `cb(err, block)`.

Note that this requires the blockchain to be traversed (from the tip or genesis block, whichever is closest), so it runs in `O(N)` time.

----
#### `chain.getTip()`

Returns the highest block added to the chain.

----
#### `chain.getPath(from, to, callback)`

Gets the path of blocks between `from` and `to`. This is useful to know which blocks to process or unprocess when getting from one part of a chain to another (including going across forks). Calls the callback with `cb(err, path)` where `path` is the following:
```js
{
  add: Array,
  // an array of Blocks which should be processed

  remove: Array,
  // an array of Blocks which should be unprocessed

  fork: Block
  // the first block of the fork (if any)
}
```

**Examples:**
```
[a]<-[b]<-[c]<-[d]

'getPath(a, d)' results in:
{
  add: [ b, c, d ],
  remove: [],
  fork: undefined
}

'getPath(d, a)' results in:
{
  add: [],
  remove: [ d, c, b ],
  fork: undefined
}
```

```
[a]<-[b]<-[c]<-[d]
  \
  [e]<-[f]

'getPath(f, d)' results in:
{
  remove: [ f, e ],
  add: [ b, c, d ],
  fork: e
}
```

----
#### `chain.getPathToTip(from, callback)`

A convenience method for `chain.getPath(from, chain.getTip(), cb)`.

----
### Parameters

Parameters specify blockchain rules and constants for different cryptocurrencies and blockchains. Parameters should contain the following:
```js
{
  // REQUIRED

  // the data used in the header of the gensis block for this blockchain
  genesisHeader: {
    version: Number,
    prevHash: Buffer,
    merkleRoot: Buffer,
    time: Number,
    bits: Number,
    nonce: Number
  },

  // called to check if we should recalculate the difficulty this block
  // should call the callback with `cb(err, retarget)`
  // where `retarget` is a boolean
  shouldRetarget: function (block, callback) { ... },

  // called to calculate the new difficulty
  // should call the callback with `cb(err, target)`,
  // where `target` is a Buffer containing the target hash
  calculateTarget: function (prevBlock, blockchain, callback) { ... },

  // called to compute the hash of the header used to verify mining
  // should call the callback with `cb(err, hash)`,
  // where `hash` is a Buffer
  miningHash: function (header, callback) { ... },

  // OPTIONAL

  // an array of blocks to use to speed up initial blockchain sync,
  // or as an extra source of data for verifying headers received from peers.
  // any number of blocks can be provided, and they should be sorted ascending by height
  checkpoints: [
    {
      height: Number,
      header: {
        version: Number,
        prevHash: Buffer,
        merkleRoot: Buffer,
        time: Number,
        bits: Number,
        nonce: Number
      }
    }
  ]
}
```

For an example, see the blockchain parameters in the [`webcoin-bitcoin` repo](https://github.com/mappum/webcoin-bitcoin/blob/master/blockchain.js).
