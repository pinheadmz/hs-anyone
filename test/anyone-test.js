/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('assert');
const Renewer = require('../lib/renewer');
const Funder = require('../lib/funder');
const {WalletClient, NodeClient} = require('hs-client');
const {FullNode, Network} = require('hsd');

const network = Network.get('regtest');
const {
  treeInterval,
  biddingPeriod,
  revealPeriod,
  transferLockup
} = network.names;

const node = new FullNode({
  network: network.type,
  memory: true,
  plugins: [require('hsd/lib/wallet/plugin')],
  indexTx: true
});

const wclient = new WalletClient({
  port: network.walletPort
});

const nclient = new NodeClient({
  port: network.rpcPort
});

describe('Renew', function() {
  let addr;
  let name;
  let mtx;

  before(async () => {
    await node.open();
  });

  after(async () => {
    await node.close();
  });

  it('should fund primary wallet', async () => {
    addr = await wclient.execute('getnewaddress', []);
    await nclient.execute('generatetoaddress', [100, addr]);
  });

  it('should win name', async () => {
    name = await nclient.execute('grindname', [4]);
    await wclient.execute('sendopen', [name]);
    await nclient.execute('generatetoaddress', [treeInterval + 1, addr]);
    await wclient.execute('sendbid', [name, 10000, 10000]);
    await wclient.execute('sendbid', [name, 20000, 20000]);
    await nclient.execute('generatetoaddress', [biddingPeriod, addr]);
    await wclient.execute('sendreveal', [name]);
    await nclient.execute('generatetoaddress', [revealPeriod, addr]);
    await wclient.execute(
      'sendupdate',
      [
        name,
        {records:[{type: 'TXT', txt: ['Have a nice day ;-)']}]}
      ]
    );
    await nclient.execute('generatetoaddress', [treeInterval, addr]);
    const res = await nclient.execute('getnameresource', [name]);
    assert.strictEqual(res.records[0].txt[0], 'Have a nice day ;-)');

    // Fresh
    const {info} = await nclient.execute('getnameinfo', [name]);
    assert.strictEqual(info.renewals, 0);
  });

  it('should transfer name', async () => {
    await wclient.execute(
      'sendtransfer',
      [
        name,
        'rs1qu3nrzrjkd783ftpk7l4hvpa96aazx5dddw66hgs2zuukckcchrqs570axm'
      ]
    );
    await nclient.execute('generatetoaddress', [transferLockup, addr]);
    await wclient.execute('sendfinalize', [name]);
    await nclient.execute('generatetoaddress', [treeInterval, addr]);

    // Counts as first renewal
    const {info} = await nclient.execute('getnameinfo', [name]);
    assert.strictEqual(info.renewals, 1);
  });

  it('should get renewal MTX', async () => {
    const renewer = new Renewer({name, network, nclient, wclient});
    mtx = await renewer.getMTX();

    assert.strictEqual(mtx.inputs.length, 1);
    assert.strictEqual(mtx.outputs.length, 1);
  });

  it('should fund renewal mtx', async () => {
    const funder = new Funder({network, nclient, wclient});
    const tx = await funder.fund(mtx);

    // non-contextual valid
    tx.check(mtx.view);

    // send
    await nclient.broadcast(tx.toHex());

    // contextual valid
    const mempool = await nclient.execute('getrawmempool', []);
    assert.strictEqual(mempool.length, 1);
    assert.strictEqual(mempool[0], tx.txid());

    // renew successful
    await nclient.execute('generatetoaddress', [1, addr]);
    const {info} = await nclient.execute('getnameinfo', [name]);
    assert.strictEqual(info.renewals, 2);

    // renew just happened
    const {chain} = await nclient.getInfo();
    assert.strictEqual(info.renewal, chain.height);

    // fee we paid is within 10% of default fee rate
    const meta = await nclient.getTX(tx.txid());
    const delta = network.feeRate - meta.rate;
    const pct = delta / network.feeRate;
    assert(pct <= 0.10);
  });
});
