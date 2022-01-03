'use strict';

const {
  Network,
  Coin,
  Amount,
  TX
} = require('hsd');

const TIMEOUT = 10; // seconds

class Funder {
  constructor(options) {
    this.nclient = options.nclient;
    this.wclient = options.wclient;

    if (typeof options.network === 'string')
      this.network = Network.get(options.network);
    else
      this.network = options.network;

    this.rate = options.rate || this.network.feeRate;
  }

  async fund(mtx, passphrase) {
    const coins = await this.wclient.execute('listunspent', []);
    coins.sort(sortValue);

    let funds = null;
    let fundsJSON = null;
    while (coins.length) {
      const walletCoin = coins.shift();
      const json = await this.nclient.getCoin(walletCoin.txid, walletCoin.vout);
      const coin = Coin.fromJSON(json);

      if (coin.covenant.isNonspendable())
        continue;

      // Get highest value, mature-if-coinbase coin
      if (!coin.coinbase ||
          (walletCoin.confirmations > this.network.coinbaseMaturity)) {
        funds = coin;
        fundsJSON = json;
        break;
      }
    }

    if (!funds)
      throw new Error('Can not fund tx: no spendable coins.');

    if (passphrase)
      await this.wclient.execute('walletpassphrase', [passphrase, TIMEOUT]);

    const priv = await this.wclient.execute(
      'dumpprivkey',
      [funds.address.toString(this.network)]
    );
    const change = await this.wclient.execute('getrawchangeaddress', []);

    mtx.addCoin(funds);
    mtx.addOutput(change, funds.value);

    let vsize = mtx.getVirtualSize();

    // Include (scaled) witness bytes for funding input sig + pubkey
    vsize += ((1 + 65 + 1 + 33) / 4);
    const fee = parseInt(this.rate * (vsize / 1000));

    if (fee > mtx.outputs[1].value) {
      throw new Error(
        'Insufficent funds to pay fee. ' +
        `Have: ${Amount.fromBase(mtx.outputs[1].value)} `+
        `Need: ${Amount.fromBase(fee)}`
      );
    }

    mtx.outputs[1].value -= fee;

    // Don't bother with dust change, just spend it
    if (mtx.outputs[1].isDust())
      mtx.outputs.pop();

    const owner = mtx.view.getCoinFor(mtx.inputs[0]).getJSON(this.network);

    const signed = await this.nclient.execute(
      'signrawtransaction',
      [
        mtx.toHex(),
        [
          {
            txid: owner.hash,
            vout: owner.index,
            address: owner.address,
            amount: Amount.coin(owner.value, true)
          },
          {
            txid: fundsJSON.hash,
            vout: fundsJSON.index,
            address: fundsJSON.address,
            amount: Amount.coin(fundsJSON.value, true)
          }
        ],
        [priv]
      ]
    );

    return TX.fromHex(signed.hex);
  }
}

// from hsd mtx CoinSelector
function sortValue(a, b) {
  if (a.confirmations === 0 && b.confirmations !== 0)
    return 1;

  if (a.confirmations !== 0 && b.confirmations === 0)
    return -1;

  return b.amount - a.amount;
}

module.exports = Funder;
