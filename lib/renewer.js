'use strict';

const {
  MTX,
  Rules,
  Output,
  Network
} = require('hsd');
const {types} = Rules;
const {getCoin, getRenewalBlock} = require('./common');

// ANYONE-CAN-RENEW address:
//
// Script: OP_TYPE OP_8 OP_EQUAL
// Serialized script: d05887
// Script hash: e466310e566f8f14ac36f7eb7607a5d77a2351ad6bb5aba20a17396c5b18b8c1
//
// main:    hs1qu3nrzrjkd783ftpk7l4hvpa96aazx5dddw66hgs2zuukckcchrqsw3f8kc
// testnet: ts1qu3nrzrjkd783ftpk7l4hvpa96aazx5dddw66hgs2zuukckcchrqsj8gmfv
// regtest: rs1qu3nrzrjkd783ftpk7l4hvpa96aazx5dddw66hgs2zuukckcchrqs570axm
// simnet:  ss1qu3nrzrjkd783ftpk7l4hvpa96aazx5dddw66hgs2zuukckcchrqs4kzusf

const SCRIPT_HASH = Buffer.from(
  'e466310e566f8f14ac36f7eb7607a5d77a2351ad6bb5aba20a17396c5b18b8c1',
  'hex'
);

const SCRIPT = Buffer.from('d05887', 'hex');

class Renewer {
  constructor(options) {
    this.nclient = options.nclient;
    this.wclient = options.wclient;
    this.name = options.name;

    if (typeof options.network === 'string')
      this.network = Network.get(options.network);
    else
      this.network = options.network;
  }

  async getMTX() {
    const coin = await getCoin(this.nclient, this.name);

    if (!coin)
      throw new Error('Could not find coin for name.');

    if (!coin.address.hash.equals(SCRIPT_HASH) ||
        coin.address.version !== 0)
      throw new Error('Name is not owned by ANYONE-CAN-RENEW address.');

    const mtx = new MTX();
    mtx.addCoin(coin);

    mtx.inputs[0].witness.items.push(SCRIPT);

    const output = new Output({
      address: coin.address,
      value: coin.value
    });
    output.covenant.type = types.RENEW;
    output.covenant.push(coin.covenant.items[0]);
    output.covenant.push(coin.covenant.items[1]);
    output.covenant.pushHash(await getRenewalBlock(this.nclient, this.network));
    mtx.outputs.push(output);

    return mtx;
  }
}

module.exports = Renewer;
