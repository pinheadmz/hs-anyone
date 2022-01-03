'use strict';

const assert = require('assert');
const {
  MTX,
  Rules,
  Output,
  Network,
  Script,
  Opcode,
  Address
} = require('hsd');
const {types} = Rules;
const {getCoin, getRenewalBlock} = require('./common');

const SCRIPT_TEMPLATE = [
  Opcode.fromSymbol('type'),
  Opcode.fromInt(Rules.types.TRANSFER),
  Opcode.fromSymbol('equal'),
  Opcode.fromSymbol('if'),
  null,
  Opcode.fromSymbol('checksig'),
  Opcode.fromSymbol('else'),
  Opcode.fromSymbol('type'),
  Opcode.fromInt(Rules.types.FINALIZE),
  Opcode.fromSymbol('equal'),
  Opcode.fromSymbol('endif')
];

class Finalizer {
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

    const tx = await this.nclient.getTX(coin.hash.toString('hex'));

    if (!tx)
      throw new Error('Could not get parent TX with TRANSFER.');

    const input = tx.inputs[coin.index];

    if (!input)
      throw new Error('Could not find input with TRASNFER script.');

    const script = Script.fromJSON(input.witness[1]);

    this.verifyScript(script);

    const mtx = new MTX();
    mtx.addCoin(coin);

    mtx.inputs[0].witness.items.push(script.encode());

    const address = new Address({
      version: coin.covenant.items[2].readUInt8(),
      hash: coin.covenant.items[3]
    });

    const {info: ns} = await this.nclient.execute('getnameinfo', [this.name]);
    let flags = 0;

    if (ns.weak)
      flags |= 1;

    const output = new Output({
      address,
      value: coin.value
    });
    output.covenant.type = types.FINALIZE;
    output.covenant.push(coin.covenant.items[0]);
    output.covenant.push(coin.covenant.items[1]);
    output.covenant.push(Buffer.from(this.name, 'ascii'));
    output.covenant.pushU8(flags);
    output.covenant.pushU32(ns.claimed);
    output.covenant.pushU32(ns.renewals);
    output.covenant.pushHash(await getRenewalBlock(this.nclient, this.network));
    mtx.outputs.push(output);

    return mtx;
  }

  verifyScript(script) {
    const ops = script.toArray();
    for (let i = 0; i < SCRIPT_TEMPLATE.length; i++) {
      const expected = SCRIPT_TEMPLATE[i];

      if (!expected)
        continue;

      assert(
        ops[i] && ops[i].encode().equals(expected.encode()),
        'Script is not HIP-1.'
      );
    }
  }
}

module.exports = Finalizer;
