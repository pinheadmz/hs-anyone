/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('assert');
const Renewer = require('../lib/renewer');
const Funder = require('../lib/funder');
const Finalizer = require('../lib/finalizer');
const {WalletClient, NodeClient} = require('hs-client');
const {
  FullNode,
  Network,
  Script,
  Rules,
  hd,
  Opcode,
  Address,
  MTX,
  TX
} = require('hsd');

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
  indexTx: true,
  noDns: true
});

const wclient = new WalletClient({
  port: network.walletPort
});

const nclient = new NodeClient({
  port: network.rpcPort
});

describe('Renew', function() {
  let miner;
  let name;
  let mtx;

  before(async () => {
    await node.open();
  });

  after(async () => {
    await node.close();
  });

  it('should fund primary wallet', async () => {
    miner = await wclient.execute('getnewaddress', []);
    await nclient.execute('generatetoaddress', [100, miner]);
  });

  it('should win name', async () => {
    name = await nclient.execute('grindname', [4]);
    await wclient.execute('sendopen', [name]);
    await nclient.execute('generatetoaddress', [treeInterval + 1, miner]);
    await wclient.execute('sendbid', [name, 10000, 10000]);
    await wclient.execute('sendbid', [name, 20000, 20000]);
    await nclient.execute('generatetoaddress', [biddingPeriod, miner]);
    await wclient.execute('sendreveal', [name]);
    await nclient.execute('generatetoaddress', [revealPeriod, miner]);
    await wclient.execute(
      'sendupdate',
      [
        name,
        {records:[{type: 'TXT', txt: ['Have a nice day ;-)']}]}
      ]
    );
    await nclient.execute('generatetoaddress', [treeInterval, miner]);
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
    await nclient.execute('generatetoaddress', [transferLockup, miner]);
    await wclient.execute('sendfinalize', [name]);
    await nclient.execute('generatetoaddress', [treeInterval, miner]);

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
    await nclient.execute('generatetoaddress', [1, miner]);
    const {info} = await nclient.execute('getnameinfo', [name]);
    assert.strictEqual(info.renewals, 2);

    // renew just happened
    const {chain} = await nclient.getInfo();
    assert.strictEqual(info.renewal, chain.height);

    // fee we paid is within 1% of default fee rate
    const meta = await nclient.getTX(tx.txid());
    const delta = network.feeRate - meta.rate;
    const pct = delta / network.feeRate;
    assert(pct <= 0.01);
  });
});

describe('Finalize', function() {
  const xpriv = hd.generate();
  const priv = xpriv.privateKey;
  const pub = xpriv.publicKey;
  const script = new Script([
    Opcode.fromSymbol('type'),
    Opcode.fromInt(Rules.types.TRANSFER),
    Opcode.fromSymbol('equal'),
    Opcode.fromSymbol('if'),
    Opcode.fromPush(pub),
    Opcode.fromSymbol('checksig'),
    Opcode.fromSymbol('else'),
    Opcode.fromSymbol('type'),
    Opcode.fromInt(Rules.types.FINALIZE),
    Opcode.fromSymbol('equal'),
    Opcode.fromSymbol('endif')
  ]);

  let miner;
  let name;
  let mtx;
  let finalize;

  before(async () => {
    await node.open();
  });

  after(async () => {
    await node.close();
  });

  it('should fund primary wallet', async () => {
    miner = await wclient.execute('getnewaddress', []);
    await nclient.execute('generatetoaddress', [100, miner]);
  });

  it('should win name', async () => {
    name = await nclient.execute('grindname', [4]);
    await wclient.execute('sendopen', [name]);
    await nclient.execute('generatetoaddress', [treeInterval + 1, miner]);
    await wclient.execute('sendbid', [name, 10000, 10000]);
    await wclient.execute('sendbid', [name, 20000, 20000]);
    await nclient.execute('generatetoaddress', [biddingPeriod, miner]);
    await wclient.execute('sendreveal', [name]);
    await nclient.execute('generatetoaddress', [revealPeriod, miner]);
    await wclient.execute(
      'sendupdate',
      [
        name,
        {records:[{type: 'TXT', txt: ['Have a nice day ;-)']}]}
      ]
    );
    await nclient.execute('generatetoaddress', [treeInterval, miner]);
    const res = await nclient.execute('getnameresource', [name]);
    assert.strictEqual(res.records[0].txt[0], 'Have a nice day ;-)');

    // Fresh
    const {info} = await nclient.execute('getnameinfo', [name]);
    assert.strictEqual(info.renewals, 0);

    // Wallet owns name
    const names = await wclient.execute('getnames', [true]);
    assert.strictEqual(names.length, 1);
    assert.strictEqual(names[0].name, name);
  });

  it('should transfer name to HIP-1 address', async () => {
    const addr = Address.fromScript(script).toString(network);

    await wclient.execute('sendtransfer', [name, addr]);
    await nclient.execute('generatetoaddress', [transferLockup, miner]);
    finalize = await wclient.execute('sendfinalize', [name]);
    finalize = TX.fromJSON(finalize);
    await nclient.execute('generatetoaddress', [treeInterval, miner]);

    // Counts as first renewal
    const {info} = await nclient.execute('getnameinfo', [name]);
    assert.strictEqual(info.renewals, 1);

    // Wallet doesn't own name
    const names = await wclient.execute('getnames', [true]);
    assert.strictEqual(names.length, 0);
  });

  it('should transfer from HIP-1 address to auction winner', async () => {
    const win = new MTX();
    win.addTX(finalize, 0);

    const addr = Address.fromString(
      await wclient.execute('getnewaddress', []),
      network
    );
    win.addOutput({
      address: finalize.outputs[0].address,
      value: finalize.outputs[0].value,
      covenant: {
        type: Rules.types.TRANSFER,
        items: [
          Buffer.from(finalize.outputs[0].covenant.items[0], 'hex'),
          Buffer.from(finalize.outputs[0].covenant.items[1], 'hex'),
          Buffer.from([addr.version]),
          addr.hash
        ]
      }
    });

    const sig = win.signature(
      0,
      script,
      finalize.outputs[0].value,
      priv,
    );
    win.inputs[0].witness.push(sig);
    win.inputs[0].witness.push(script.encode());

    await nclient.broadcast(win.toHex());
    await nclient.execute('generatetoaddress', [1, miner]);

    // Verify transfer
    const {info} = await nclient.execute('getnameinfo', [name]);
    const {chain} = await nclient.getInfo();
    assert.strictEqual(info.transfer, chain.height);

    // Finish lockup period
    await nclient.execute('generatetoaddress', [transferLockup - 1, miner]);
  });

  it('should get finalize MTX', async () => {
    const finalizer = new Finalizer({name, network, nclient, wclient});
    mtx = await finalizer.getMTX();

    assert.strictEqual(mtx.inputs.length, 1);
    assert.strictEqual(mtx.outputs.length, 1);
  });

  it('should fund finalize mtx', async () => {
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

    // finalize successful
    await nclient.execute('generatetoaddress', [1, miner]);
    const {info} = await nclient.execute('getnameinfo', [name]);
    assert.strictEqual(info.renewals, 2);

    // finalize just happened
    const {chain} = await nclient.getInfo();
    assert.strictEqual(info.renewal, chain.height);

    // fee we paid is within 1% of default fee rate
    const meta = await nclient.getTX(tx.txid());
    const delta = network.feeRate - meta.rate;
    const pct = delta / network.feeRate;
    assert(pct <= 0.01);

    // Wallet owns name again
    const names = await wclient.execute('getnames', [true]);
    assert.strictEqual(names.length, 1);
    assert.strictEqual(names[0].name, name);
  });
});
