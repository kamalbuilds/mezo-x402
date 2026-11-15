# mezo-x402 — pay per call in MUSD

An x402-gated paid API storefront on **Mezo**. Agents and developers discover
paid endpoints priced in **MUSD**, pay per request with **one signature**, and
never create an account. Built for the Mezo Buildathon, Access & Distribution
track.

## Live surface

| Route | Price | What it returns |
|---|---|---|
| `GET /` | free | Landing page: catalog, prices, curl example |
| `GET /api/btc-price` | $0.01 | BTC/USDT 24h ticker (Binance) |
| `GET /api/mempool` | $0.02 | Bitcoin mempool fee estimates + tip height |
| `GET /api/mezo-network` | $0.03 | Mezo testnet block height, gas price, chain id |
| `GET /api/musd-stats` | $0.03 | MUSD totalSupply / symbol / decimals on-chain |
| `GET /api/mezo-market` | $0.02 | MEZO/USD price, 24h change, market cap |
| `GET /demo` | $0.001 | Minimal paywall smoke test |

Every paid route returns `402 Payment Required` with a `PAYMENT-REQUIRED`
response header (base64 JSON: scheme, network, asset, amount, payTo) until a
payment settles. Browser requests get the bundled `@x402/paywall` UI; curl,
fetch, and agents get JSON.

## Architecture

```
client ──GET──> Express server ──402 + PAYMENT-REQUIRED──> client
client ──GET + payment header──> server ──verify/settle──> facilitator.vativ.io
                                            │
                                            └─ MUSD transfer on Mezo, gas paid by facilitator
server ──> upstream APIs (Binance, mempool.space, CoinGecko, Mezo RPC) ──> JSON
```

- `server.ts` — Express app. `@x402/express` `paymentMiddleware` guards every
  paid route; `x402ResourceServer` registers the `exact` EVM scheme for
  `eip155:31611`; `HTTPFacilitatorClient` points at `facilitator.vativ.io`.
  Prices are dollar strings (`"$0.01"`); `@x402/evm` resolves them to MUSD at
  runtime — no token address in route config.
- `client.js` — Node buyer. `@x402/fetch` `wrapFetchWithPayment` answers the
  402, `registerExactEvmScheme` signs an EIP-712 permit2 authorization with the
  buyer key, and the request retries with the payment header.

## Mezo / x402 constants

| Item | Value |
|---|---|
| Network | Mezo testnet, CAIP-2 `eip155:31611` (mainnet `eip155:31612`) |
| RPC | `https://rpc.test.mezo.org` |
| Explorer | `https://explorer.test.mezo.org` |
| MUSD (testnet) | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` (18 decimals) |
| Facilitator | `https://facilitator.vativ.io` (serves testnet + mainnet) |
| Settlement proxy | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` (SDK auto-resolves) |
| SDK | `@x402/*` 2.16.0 pinned (Mezo testnet support since `@x402/evm` 2.10.0, mainnet since 2.15.0) |

## Setup

```bash
npm install
PAY_TO=0x<your-merchant-address> npm start   # serves http://localhost:4021
```

`PAY_TO` is the address that receives every MUSD payment. The built-in default
is the hosted x402 demo merchant address — override it before accepting real
payments. `PORT`, `NETWORK`, `FACILITATOR_URL`, `MEZO_RPC`, `PUBLIC_URL` are
also env-configurable.

### Getting testnet MUSD (the one human step)

MUSD on testnet is minted, not faucet-dispensed: you borrow it against testnet
BTC.

1. Request testnet BTC at `https://faucet.test.mezo.org` (or the Mezo Discord
   `#testnet` channel) to your buyer wallet.
2. Add Mezo Testnet to the wallet: chain id `31611`, RPC
   `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`.
3. Borrow MUSD at `https://mezo.org/feature/borrow`. Minimum borrow is
   2,000 MUSD (1,800 principal + 200 gas deposit); the balance is reusable.
4. For the Node client, export the buyer private key:
   `PRIVATE_KEY=0x...` and run `node client.js /api/btc-price`.

## Verify it yourself

```bash
npm start &                                   # terminal 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4021/api/btc-price
# -> 402   (payment required; this is the gate working)
curl -si http://localhost:4021/api/btc-price | head -20
# -> PAYMENT-REQUIRED header carries the machine-readable requirements
open http://localhost:4021/api/btc-price      # browser -> @x402/paywall UI
PRIVATE_KEY=0x... node client.js /api/btc-price
# -> signs once, pays $0.01 MUSD, prints the JSON ticker
```

## Deploy

Any Node host works — the server is a single process with no state and no
build step.

**Railway:** New Project → Deploy from GitHub repo → set `PAY_TO` (and
optionally `PORT`, which Railway provides automatically). Health check:
`GET /` returns the landing page.

**Fly.io:**

```bash
fly launch --no-deploy
fly secrets set PAY_TO=0x<merchant> PUBLIC_URL=https://<app>.fly.dev
fly deploy
```

**Docker:** `node:22-alpine`, `npm ci && npm start`, expose `$PORT`.

For mainnet, set `NETWORK=eip155:31612` and a mainnet `PAY_TO`; `@x402/evm`
2.16.0 resolves mainnet MUSD (`0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`)
automatically. Mainnet payments settle real MUSD and the facilitator pays real
BTC gas — test with small prices first.

## Judging criteria map

- **Mezo Integration** — payments settle in MUSD on Mezo testnet through the
  canonical facilitator; two endpoints (`/api/mezo-network`, `/api/musd-stats`)
  read live Mezo chain state, so the product is Mezo-native, not a generic
  x402 demo.
- **Product Viability** — a real storefront pattern: priced endpoints, a
  catalog page, a working programmatic buyer, env-configurable merchant
  address. Any API operator can clone this and put their own data behind the
  same middleware.
- **Technical Implementation** — canonical `@x402/*` SDK stack (pinned
  2.16.0), permit2 + EIP-2612 settlement, facilitator-sponsored gas, live
  upstream data with honest 502s, TypeScript strict.
- **UX** — zero-account browser paywall for humans, one-command
  `node client.js` for agents, curl-friendly 402 semantics, prices visible
  before payment.
- **Materials** — this README, `SUBMISSION.md`, and the repo itself are the
  submission artifacts.

## Layout

```
server.ts    Express app: paywall routes + free landing page + paid handlers
client.js    Node buyer: @x402/fetch payment flow end to end
package.json pinned deps (@x402/* 2.16.0)
tsconfig.json
SUBMISSION.md  hackathon submission notes + manual steps
```
