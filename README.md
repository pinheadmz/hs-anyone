# hs-anyone

## A nodejs package to pay the fee for an "anyone can" transaction

### Installation

The only requirements are `hsd` and `hs-client`. These are peer dependencies,
it is assumed that the user already has them installed locally (you need a
running node and wallet to use this package).

### Usage

```
Usage: $ hs-anyone [command] [name] [options]

Commands:
  renew         renew an anyone-can-renew name

Options:
  --wallet      wallet ID (default: primary)
  --passphrase  wallet passphrase (default: none)
  --network     (default: regtest)
  --rate        fee rate in dollarydoos per kB (default: network default)
  --broadcast   whether or not to broadcast the signed transaction (default: false)
```


### Examples

ANYONE-CAN-RENEW: Names like `badass` and `forever` can be renewed by anyone
willing to pay the miner fee

ANYONE-CAN-FINALIZE: (coming soon) Shakedex auction winners don't have to finalize
their own filled bids, and this feature may be useful for stuck wallets.

```
$ bin/hs-anyone renew forever --network main --broadcast true
```

Program output will be the signed transaction in JSON with CoinView (to display fee).

Renewal of the name `forever` using this program generated txid

```
5634f5f212231b35aca7b645e61368b30fb50786fb9e618dd3891b76c0f57b8a
```

...confirmed in mainnet block #101,175.