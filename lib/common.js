'use strict';

const {Coin} = require('hsd');

exports.getCoin = async (nclient, name) => {
  const {info} = await nclient.execute('getnameinfo', [name]);

  if (!info || !info.owner)
    return null;

  const {hash, index} = info.owner;
  const coin = await nclient.getCoin(hash, index);

  return Coin.fromJSON(coin);
};

exports.getRenewalBlock = async (nclient, network) => {
  const {chain} = await nclient.getInfo();
  let {height} = chain;
  height -= (network.names.renewalMaturity * 2);

  const hash = await nclient.execute('getblockhash', [height]);
  return Buffer.from(hash, 'hex');
};
