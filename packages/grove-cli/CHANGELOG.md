# @ferueda/grove-cli

## [1.1.0](https://github.com/ferueda/grove/compare/grove-cli-v1.0.0...grove-cli-v1.1.0) (2026-06-13)


### Features

* **cli:** add acquire.ts ([8bb9bf6](https://github.com/ferueda/grove/commit/8bb9bf6a7771f411a8987edf1977467e0f898cf2))
* **cli:** add cli.ts ([3805d57](https://github.com/ferueda/grove/commit/3805d573a7ea793c50bcb027188a5aa0222e85f4))
* **cli:** add destroy.ts ([8ebd41e](https://github.com/ferueda/grove/commit/8ebd41e94046790c44b6564d02dd9916fe895529))
* **cli:** add package.json ([a670e7d](https://github.com/ferueda/grove/commit/a670e7d2d8b88539841219f7b114e962a1e9e71e))
* **cli:** add release.ts ([dc56957](https://github.com/ferueda/grove/commit/dc569573637ac10ac70ca61a7ac74e23d45c87b3))
* **cli:** add status.ts ([af6a688](https://github.com/ferueda/grove/commit/af6a688dd6ad6a9f5b474797af10976283192100))
* **cli:** add tsconfig.json ([d2cb0a7](https://github.com/ferueda/grove/commit/d2cb0a71dbe66dbaf68a12ce9f94e6924d3fbcac))
* **cli:** add utils.ts ([482f302](https://github.com/ferueda/grove/commit/482f302ab314fb24b67df07be31e5d56493af65b))
* **cli:** update acquire.ts for lease mode ([95def9d](https://github.com/ferueda/grove/commit/95def9d41daffe70694efcf5e81b68a0b8c8b7e1))
* **cli:** update cli.ts for lease mode ([94d717a](https://github.com/ferueda/grove/commit/94d717ade2acf96a625b126fa488314209c9f41e))
* **cli:** update destroy.ts for lease mode ([38ea946](https://github.com/ferueda/grove/commit/38ea946af68b2d5572f27bf3a952f05b9b6ca71a))
* **cli:** update error-handler.ts for lease mode ([1c920ae](https://github.com/ferueda/grove/commit/1c920ae92ef2e10026d37281c67d176995c2c840))
* **cli:** update inspect.ts for lease mode ([4d2e2b3](https://github.com/ferueda/grove/commit/4d2e2b335ff0c3d054741ba8e6f5cbd07b49bd39))
* **cli:** update release.ts for lease mode ([e317c2b](https://github.com/ferueda/grove/commit/e317c2be08534ac2af752d98d8b5b19c36316aa8))
* **cli:** update repair.ts for lease mode ([e738c9a](https://github.com/ferueda/grove/commit/e738c9aeb8132a8582cc9d927fc891cb635ce8f7))
* **cli:** update status.ts for lease mode ([87ef258](https://github.com/ferueda/grove/commit/87ef2584808e57ada3ba25792f3f8ebcf128b108))
* implement lease mode for DaddyBot compatibility ([c2545c0](https://github.com/ferueda/grove/commit/c2545c0cfb1d83acf6bf726fb1485b70e9ff2932))
* implement v1 lease acquire, inspect, and list ([ab5277e](https://github.com/ferueda/grove/commit/ab5277e3ed7b2cffa3390fa7981fb55de77cffc3))
* implement v1 lease release with ReleaseResult and resume-cleanup ([6c41dcd](https://github.com/ferueda/grove/commit/6c41dcd3eb678fe5283d137e1284a74bd65b0c62))
* implement v1 repair matrix and mutator enforcement ([d494451](https://github.com/ferueda/grove/commit/d49445146207d10110d98ac24b0db9ac5fe2b251))
* monorepo migration & CLI wrapper ([89e6a20](https://github.com/ferueda/grove/commit/89e6a2029e98a27bd37cd0cb953c60eab7485a2d))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([5a499b9](https://github.com/ferueda/grove/commit/5a499b960a7801198574c699b444c8b451ed01ab))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([16ff72f](https://github.com/ferueda/grove/commit/16ff72fffb1e074c6a6713b9b70c4869482d2767))
* v1 lease acquire, inspect, and list (PR 2) ([a97762c](https://github.com/ferueda/grove/commit/a97762c98da8e4ac815a7cb52a46340dfd6e5df9))
* v1 lease release with ReleaseResult (PR 3) ([f3962fd](https://github.com/ferueda/grove/commit/f3962fd47649829fb36fd162af48d839ca1a0f0a))
* v1 lease repair matrix and mutator enforcement (PR 5) ([5bbf69d](https://github.com/ferueda/grove/commit/5bbf69dd886f0503c363d57587753c3ec3809b4e))
* v1 lease-first API cutover and CLI JSON envelopes ([1860c63](https://github.com/ferueda/grove/commit/1860c63c16527bc95dbfa9c6313d579a46f53c8a))
* v1 lease-first API cutover and CLI JSON envelopes (PR 6) ([9e3e177](https://github.com/ferueda/grove/commit/9e3e17798f2776de543f36bc0386d2347f11f4c6))


### Bug Fixes

* add publishConfig access public to allow changesets to publish scoped packages ([b188d60](https://github.com/ferueda/grove/commit/b188d6072ed2ee5fb6a1bc6f59c92e397b549dc0))
* add repository field to package.json for OIDC provenance ([2545591](https://github.com/ferueda/grove/commit/2545591bb5fdb4b20e3d1ab7e3d2d082f5055b58))
* add shebang to CLI entry point ([#21](https://github.com/ferueda/grove/issues/21)) ([64c144d](https://github.com/ferueda/grove/commit/64c144d66cb8bcd0f7b23fab07641c0ec686dbff))
* apply PR 3 review fixes and document PR 4 deferrals ([d1f4aa8](https://github.com/ferueda/grove/commit/d1f4aa8349f80216a9ea08f55fde069445a58ae3))
* harden CLI error handling and align CI to Node 24 ([#23](https://github.com/ferueda/grove/issues/23)) ([194d40c](https://github.com/ferueda/grove/commit/194d40c1480800a09c48fc9c252ece429dbf8b71))
* harden v1 lease recovery ([52b6344](https://github.com/ferueda/grove/commit/52b6344a62ae44f95a6fa17bb4f1aa859675cda9))
* harden v1 lease recovery ([2043cbd](https://github.com/ferueda/grove/commit/2043cbd929fff01a7c8caf90126f784c2e6d8fba))
* implement review feedback for acquire.ts ([ea9ab12](https://github.com/ferueda/grove/commit/ea9ab12e561e6c066dd02b850d30dd5f7dcd9897))
* implement review feedback for cli.ts ([237bb6d](https://github.com/ferueda/grove/commit/237bb6d1b0e64afc9fecf698908411bc12b966b3))
* implement review feedback for utils.ts ([2e4a8a3](https://github.com/ferueda/grove/commit/2e4a8a383dded582acaaad27c56e38a8f225039a))
* validate leaseId at API boundary before state writes ([612b95c](https://github.com/ferueda/grove/commit/612b95c43d1b459dbe11ed5f96e8eb8b6fada69e))
* validate leaseId at Grove API boundary before state writes ([89006cc](https://github.com/ferueda/grove/commit/89006cca432decc94d0b38de9fc2dae9280512c0))

## [1.0.0](https://github.com/ferueda/grove/compare/grove-cli-v0.3.0...grove-cli-v1.0.0) (2026-06-13)


### ⚠ BREAKING CHANGES

* **lease-first CLI cutover** — Grove CLI v1 matches the lease-first SDK.
  * Acquire requires `--lease-id` and `--ref` / `--branch`; release and destroy require `--lease-id`.
  * `list` replaces `status`; `destroy-all` removed.
  * `--json` emits stable envelopes (`{ ok, lease }`, `{ ok, result }`, `{ ok, leases }`, `{ ok: false, error }`).
  * Human prose goes to stderr in `--json` mode; exit codes map to error classes.


### Features

* implement v1 lease acquire, inspect, and list ([ab5277e](https://github.com/ferueda/grove/commit/ab5277e3ed7b2cffa3390fa7981fb55de77cffc3))
* implement v1 lease release with ReleaseResult and resume-cleanup ([6c41dcd](https://github.com/ferueda/grove/commit/6c41dcd3eb678fe5283d137e1284a74bd65b0c62))
* implement v1 repair matrix and mutator enforcement ([d494451](https://github.com/ferueda/grove/commit/d49445146207d10110d98ac24b0db9ac5fe2b251))
* v1 lease acquire, inspect, and list (PR 2) ([a97762c](https://github.com/ferueda/grove/commit/a97762c98da8e4ac815a7cb52a46340dfd6e5df9))
* v1 lease release with ReleaseResult (PR 3) ([f3962fd](https://github.com/ferueda/grove/commit/f3962fd47649829fb36fd162af48d839ca1a0f0a))
* v1 lease repair matrix and mutator enforcement (PR 5) ([5bbf69d](https://github.com/ferueda/grove/commit/5bbf69dd886f0503c363d57587753c3ec3809b4e))
* v1 lease-first API cutover and CLI JSON envelopes ([1860c63](https://github.com/ferueda/grove/commit/1860c63c16527bc95dbfa9c6313d579a46f53c8a))
* v1 lease-first API cutover and CLI JSON envelopes (PR 6) ([9e3e177](https://github.com/ferueda/grove/commit/9e3e17798f2776de543f36bc0386d2347f11f4c6))


### Bug Fixes

* apply PR 3 review fixes and document PR 4 deferrals ([d1f4aa8](https://github.com/ferueda/grove/commit/d1f4aa8349f80216a9ea08f55fde069445a58ae3))
* harden v1 lease recovery ([52b6344](https://github.com/ferueda/grove/commit/52b6344a62ae44f95a6fa17bb4f1aa859675cda9))
* harden v1 lease recovery ([2043cbd](https://github.com/ferueda/grove/commit/2043cbd929fff01a7c8caf90126f784c2e6d8fba))
* validate leaseId at API boundary before state writes ([612b95c](https://github.com/ferueda/grove/commit/612b95c43d1b459dbe11ed5f96e8eb8b6fada69e))
* validate leaseId at Grove API boundary before state writes ([89006cc](https://github.com/ferueda/grove/commit/89006cca432decc94d0b38de9fc2dae9280512c0))

## [0.3.0](https://github.com/ferueda/grove/compare/grove-cli-v0.2.0...grove-cli-v0.3.0) (2026-06-12)


### Features

* **cli:** update acquire.ts for lease mode ([95def9d](https://github.com/ferueda/grove/commit/95def9d41daffe70694efcf5e81b68a0b8c8b7e1))
* **cli:** update cli.ts for lease mode ([94d717a](https://github.com/ferueda/grove/commit/94d717ade2acf96a625b126fa488314209c9f41e))
* **cli:** update destroy.ts for lease mode ([38ea946](https://github.com/ferueda/grove/commit/38ea946af68b2d5572f27bf3a952f05b9b6ca71a))
* **cli:** update error-handler.ts for lease mode ([1c920ae](https://github.com/ferueda/grove/commit/1c920ae92ef2e10026d37281c67d176995c2c840))
* **cli:** update inspect.ts for lease mode ([4d2e2b3](https://github.com/ferueda/grove/commit/4d2e2b335ff0c3d054741ba8e6f5cbd07b49bd39))
* **cli:** update release.ts for lease mode ([e317c2b](https://github.com/ferueda/grove/commit/e317c2be08534ac2af752d98d8b5b19c36316aa8))
* **cli:** update repair.ts for lease mode ([e738c9a](https://github.com/ferueda/grove/commit/e738c9aeb8132a8582cc9d927fc891cb635ce8f7))
* **cli:** update status.ts for lease mode ([87ef258](https://github.com/ferueda/grove/commit/87ef2584808e57ada3ba25792f3f8ebcf128b108))
* implement lease mode ([c2545c0](https://github.com/ferueda/grove/commit/c2545c0cfb1d83acf6bf726fb1485b70e9ff2932))

## [0.2.0](https://github.com/ferueda/grove/compare/grove-cli-v0.1.2...grove-cli-v0.2.0) (2026-06-11)


### Features

* **cli:** add acquire.ts ([8bb9bf6](https://github.com/ferueda/grove/commit/8bb9bf6a7771f411a8987edf1977467e0f898cf2))
* **cli:** add cli.ts ([3805d57](https://github.com/ferueda/grove/commit/3805d573a7ea793c50bcb027188a5aa0222e85f4))
* **cli:** add destroy.ts ([8ebd41e](https://github.com/ferueda/grove/commit/8ebd41e94046790c44b6564d02dd9916fe895529))
* **cli:** add package.json ([a670e7d](https://github.com/ferueda/grove/commit/a670e7d2d8b88539841219f7b114e962a1e9e71e))
* **cli:** add release.ts ([dc56957](https://github.com/ferueda/grove/commit/dc569573637ac10ac70ca61a7ac74e23d45c87b3))
* **cli:** add status.ts ([af6a688](https://github.com/ferueda/grove/commit/af6a688dd6ad6a9f5b474797af10976283192100))
* **cli:** add tsconfig.json ([d2cb0a7](https://github.com/ferueda/grove/commit/d2cb0a71dbe66dbaf68a12ce9f94e6924d3fbcac))
* **cli:** add utils.ts ([482f302](https://github.com/ferueda/grove/commit/482f302ab314fb24b67df07be31e5d56493af65b))
* monorepo migration & CLI wrapper ([89e6a20](https://github.com/ferueda/grove/commit/89e6a2029e98a27bd37cd0cb953c60eab7485a2d))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([5a499b9](https://github.com/ferueda/grove/commit/5a499b960a7801198574c699b444c8b451ed01ab))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([16ff72f](https://github.com/ferueda/grove/commit/16ff72fffb1e074c6a6713b9b70c4869482d2767))


### Bug Fixes

* add publishConfig access public to allow changesets to publish scoped packages ([b188d60](https://github.com/ferueda/grove/commit/b188d6072ed2ee5fb6a1bc6f59c92e397b549dc0))
* add repository field to package.json for OIDC provenance ([2545591](https://github.com/ferueda/grove/commit/2545591bb5fdb4b20e3d1ab7e3d2d082f5055b58))
* add shebang to CLI entry point ([#21](https://github.com/ferueda/grove/issues/21)) ([64c144d](https://github.com/ferueda/grove/commit/64c144d66cb8bcd0f7b23fab07641c0ec686dbff))
* harden CLI error handling and align CI to Node 24 ([#23](https://github.com/ferueda/grove/issues/23)) ([194d40c](https://github.com/ferueda/grove/commit/194d40c1480800a09c48fc9c252ece429dbf8b71))
* implement review feedback for acquire.ts ([ea9ab12](https://github.com/ferueda/grove/commit/ea9ab12e561e6c066dd02b850d30dd5f7dcd9897))
* implement review feedback for cli.ts ([237bb6d](https://github.com/ferueda/grove/commit/237bb6d1b0e64afc9fecf698908411bc12b966b3))
* implement review feedback for utils.ts ([2e4a8a3](https://github.com/ferueda/grove/commit/2e4a8a383dded582acaaad27c56e38a8f225039a))

## 0.1.2

### Patch Changes

- [#21](https://github.com/ferueda/grove/pull/21) [`64c144d`](https://github.com/ferueda/grove/commit/64c144d66cb8bcd0f7b23fab07641c0ec686dbff) Thanks [@ferueda](https://github.com/ferueda)! - fix: add shebang to CLI entry point

- Updated dependencies [[`64c144d`](https://github.com/ferueda/grove/commit/64c144d66cb8bcd0f7b23fab07641c0ec686dbff)]:
  - @ferueda/grove@0.1.2

## 0.1.1

### Patch Changes

- [`975f6c2`](https://github.com/ferueda/grove/commit/975f6c2eecf7105832b7fdc5802c5d390c700a5a) Thanks [@ferueda](https://github.com/ferueda)! - Automated release pipeline setup and initial configuration for NPM publishing

- Updated dependencies [[`975f6c2`](https://github.com/ferueda/grove/commit/975f6c2eecf7105832b7fdc5802c5d390c700a5a)]:
  - @ferueda/grove@0.1.1
