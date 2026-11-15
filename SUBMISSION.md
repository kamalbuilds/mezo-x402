# Akindo submission notes — Mezo Buildathon (Access & Distribution)

## What this is

`mezo-x402` is a paid API storefront: six endpoints priced $0.001-$0.03 in
MUSD, gated by the canonical `@x402/*` SDK stack on Mezo testnet
(`eip155:31611`). No accounts, no API keys — one EIP-712 signature per call,
settled by `facilitator.vativ.io` which also pays gas.

## Verified locally

- `npm install` clean; `npm start` boots `server.ts` via tsx.
- `GET /` returns the free landing page (catalog + prices + curl example).
- `GET /api/btc-price` (and every paid route) returns **402** with a
  `PAYMENT-REQUIRED` header before payment — the gate demonstrably fails
  closed.
- Browser requests to paid routes render the `@x402/paywall` UI.
- `client.js` performs the full x402 payment flow (`@x402/fetch` +
  `registerExactEvmScheme` + viem signer).

## The one human step

Testnet MUSD is minted, not dispensed: a faucet drip of testnet BTC followed
by a borrow at https://mezo.org/feature/borrow (minimum 2,000 MUSD). That
requires a wallet UI interaction and cannot be scripted from this repo.
Everything else — server, paywall, client, settlement path — is code and is
delivered working. Steps are in README.md "Getting testnet MUSD".

## Deploy before submitting (recommended)

Judges click links. Deploy to Railway or Fly (README "Deploy" section), set
`PAY_TO` to an address you control, and put the public URL in the submission.
Then do one browser payment against `/demo` ($0.001) so the explorer shows a
real MUSD transfer.

## Akindo submission checklist

1. Push this repo to GitHub (private is fine) and deploy it.
2. On Akindo, submit under the Access & Distribution track:
   - Project name: `mezo-x402 — pay per call in MUSD`
   - Repo URL, live URL, one-paragraph description.
   - Demo video (optional but recommended): open `/`, click a paid endpoint,
     pay $0.001 in the paywall, show the JSON response + explorer transfer.
3. Paste the tx hash of your own test payment as evidence in the description.

## Judge-facing one-liner

> Point any HTTP client at a priced route, get a 402, sign once, pay MUSD —
> no account, no API key, gas sponsored by the facilitator. Same middleware
> pattern works for any paid API on Mezo mainnet with `NETWORK=eip155:31612`.
