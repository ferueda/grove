# @ferueda/grove

## [1.3.1](https://github.com/ferueda/grove/compare/grove-v1.3.0...grove-v1.3.1) (2026-06-18)


### Bug Fixes

* guard release reset paths inside the pool ([59583b9](https://github.com/ferueda/grove/commit/59583b9c3ec20200e82b957a7d3c966c2882f46a))
* guard release reset paths inside the pool ([262ea94](https://github.com/ferueda/grove/commit/262ea946649b6d3587bc0f505635779b6545d4fe))
* quarantine release on out-of-pool path boundary failure ([36d0c68](https://github.com/ferueda/grove/commit/36d0c68391dba8b7b801519413b789df1c758547))

## [1.3.0](https://github.com/ferueda/grove/compare/grove-v1.2.0...grove-v1.3.0) (2026-06-13)


### Features

* add structured CLI errors and commander JSON routing ([4d91cef](https://github.com/ferueda/grove/commit/4d91cef64f9038f39912cdb2fd947d9c1da771b8))
* add structured CLI errors and commander JSON routing ([d40e5f5](https://github.com/ferueda/grove/commit/d40e5f5325f7653d45e111bff84ed2ff5e37c88f))

## [1.2.0](https://github.com/ferueda/grove/compare/grove-v1.1.0...grove-v1.2.0) (2026-06-13)


### Features

* add agent-friendly CLI discovery and structured JSON ergonomics ([9a60857](https://github.com/ferueda/grove/commit/9a60857650632fbc0fa11059b6497aa67f14523f))
* add agent-friendly CLI discovery and structured JSON ergonomics ([48fc77a](https://github.com/ferueda/grove/commit/48fc77a04a48a8586fb6394a457be91e8ec6b0ed))

## [1.1.0](https://github.com/ferueda/grove/compare/grove-v1.0.0...grove-v1.1.0) (2026-06-13)


### Features

* add lease and slot transition helpers with joint invariants ([2fbd270](https://github.com/ferueda/grove/commit/2fbd27088f5e417062204d953b43e64fe281a879))
* add lease-first state parse, read, write, and legacy migration ([fb913ba](https://github.com/ferueda/grove/commit/fb913ba80e0e94570ae1d3d02b909dbd734c415b))
* add lease-first v1 error codes and classes ([46aad01](https://github.com/ferueda/grove/commit/46aad01232b7aa86affd7517408051bfec95f5c5))
* add lease-first v1 Zod schemas for slots and leases ([0d5c9a2](https://github.com/ferueda/grove/commit/0d5c9a21e22846a9d4a793230800a5f13bcf3834))
* export lease-first v1 schemas, transitions, and state APIs ([7a50e08](https://github.com/ferueda/grove/commit/7a50e08a4d227fae889c8d9607ccaab8a0736f8c))
* **grove:** add package.json ([03f2441](https://github.com/ferueda/grove/commit/03f2441087b0a340746cf6c4eb8a3ca5419b82dd))
* **grove:** add tsconfig.json ([40e8084](https://github.com/ferueda/grove/commit/40e8084f2f7fd5e056a69eb0068f3b82fc137557))
* **grove:** update branch.ts for lease mode ([c7fdd9b](https://github.com/ferueda/grove/commit/c7fdd9b1e0f9e768793df652acfdd2cf73c8543c))
* **grove:** update detect.ts for lease mode ([998d01d](https://github.com/ferueda/grove/commit/998d01dda76b45176cd2340483b66700a12249e6))
* **grove:** update errors.ts for lease mode ([36dbfc3](https://github.com/ferueda/grove/commit/36dbfc3390a37fe1e7288115d2cf9ce9a24b0a32))
* **grove:** update hooks.ts for lease mode ([c81a403](https://github.com/ferueda/grove/commit/c81a4036006d3e88665cfe0c66d3692f6da82934))
* **grove:** update index.ts for lease mode ([2a74eaf](https://github.com/ferueda/grove/commit/2a74eaf1b3ab26cfaebe9c3974ce1f503d9c8628))
* **grove:** update pool.ts for lease mode ([4b5728d](https://github.com/ferueda/grove/commit/4b5728d340d7f1d90f47c6050e377f8839a28cde))
* **grove:** update schemas.ts for lease mode ([f6e9eb3](https://github.com/ferueda/grove/commit/f6e9eb332829c2dfe0d0226ef1170054aaf8c064))
* **grove:** update state.ts for lease mode ([71e7509](https://github.com/ferueda/grove/commit/71e7509d4edbde14d7032f7cf7713bccf860c8f7))
* **grove:** update terminate.ts for lease mode ([1f55d17](https://github.com/ferueda/grove/commit/1f55d17adcd1a387b0ab0444fac303a6961b5e19))
* implement lease mode for DaddyBot compatibility ([c2545c0](https://github.com/ferueda/grove/commit/c2545c0cfb1d83acf6bf726fb1485b70e9ff2932))
* implement v1 lease acquire, inspect, and list ([ab5277e](https://github.com/ferueda/grove/commit/ab5277e3ed7b2cffa3390fa7981fb55de77cffc3))
* implement v1 lease destroy with path safety and resume ([b5c575b](https://github.com/ferueda/grove/commit/b5c575ba6b15c100274c83d33b711c592731b132))
* implement v1 lease release with ReleaseResult and resume-cleanup ([6c41dcd](https://github.com/ferueda/grove/commit/6c41dcd3eb678fe5283d137e1284a74bd65b0c62))
* implement v1 repair matrix and mutator enforcement ([d494451](https://github.com/ferueda/grove/commit/d49445146207d10110d98ac24b0db9ac5fe2b251))
* lease-first v1 PR 1 — schemas, transitions, and state loader ([47c90f0](https://github.com/ferueda/grove/commit/47c90f089d72bfba748a08598e612a6845d3a259))
* monorepo migration & CLI wrapper ([89e6a20](https://github.com/ferueda/grove/commit/89e6a2029e98a27bd37cd0cb953c60eab7485a2d))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([5a499b9](https://github.com/ferueda/grove/commit/5a499b960a7801198574c699b444c8b451ed01ab))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([16ff72f](https://github.com/ferueda/grove/commit/16ff72fffb1e074c6a6713b9b70c4869482d2767))
* v1 lease acquire, inspect, and list (PR 2) ([a97762c](https://github.com/ferueda/grove/commit/a97762c98da8e4ac815a7cb52a46340dfd6e5df9))
* v1 lease destroy with path safety (PR 4) ([b275eb8](https://github.com/ferueda/grove/commit/b275eb8719cceecdfcc37e39a94f6e420d1e1ef2))
* v1 lease release with ReleaseResult (PR 3) ([f3962fd](https://github.com/ferueda/grove/commit/f3962fd47649829fb36fd162af48d839ca1a0f0a))
* v1 lease repair matrix and mutator enforcement (PR 5) ([5bbf69d](https://github.com/ferueda/grove/commit/5bbf69dd886f0503c363d57587753c3ec3809b4e))
* v1 lease-first API cutover and CLI JSON envelopes ([1860c63](https://github.com/ferueda/grove/commit/1860c63c16527bc95dbfa9c6313d579a46f53c8a))
* v1 lease-first API cutover and CLI JSON envelopes (PR 6) ([9e3e177](https://github.com/ferueda/grove/commit/9e3e17798f2776de543f36bc0386d2347f11f4c6))


### Bug Fixes

* add publishConfig access public to allow changesets to publish scoped packages ([b188d60](https://github.com/ferueda/grove/commit/b188d6072ed2ee5fb6a1bc6f59c92e397b549dc0))
* add repository field to package.json for OIDC provenance ([2545591](https://github.com/ferueda/grove/commit/2545591bb5fdb4b20e3d1ab7e3d2d082f5055b58))
* address lease recovery review nits ([12e5610](https://github.com/ferueda/grove/commit/12e5610b4d3a440c2accbe2f5c4e65e5e2d9d7be))
* address PR [#45](https://github.com/ferueda/grove/issues/45) review — timing parser and fetch default test ([024ebd1](https://github.com/ferueda/grove/commit/024ebd1709405452cafc810b6a46a21a72111831))
* address PR 4 destroy review findings ([606264c](https://github.com/ferueda/grove/commit/606264c08ab3e526d3a14fac57a3f169c75906b1))
* apply PR 3 review fixes and document PR 4 deferrals ([d1f4aa8](https://github.com/ferueda/grove/commit/d1f4aa8349f80216a9ea08f55fde069445a58ae3))
* clear slot owner fields on quarantine repair ([726b8f5](https://github.com/ferueda/grove/commit/726b8f5cd007c0b4b731d9479c964428b74da45b))
* correct workspace typechecking paths ([adc8e22](https://github.com/ferueda/grove/commit/adc8e22919547bbc393b2b9e0dcdcb5907e0cb44))
* declare missing execa dependency and fix test typings ([0735b1d](https://github.com/ferueda/grove/commit/0735b1d08db5ebb7df8b9b83978c0af18fb9bcdd))
* enforce leaseId-only destroy and post-hook path consistency ([b6bf96c](https://github.com/ferueda/grove/commit/b6bf96c77283096af4689ca0dcce1d4184e84278))
* fresh reset safety scan and typed release state errors ([551a37f](https://github.com/ferueda/grove/commit/551a37f62204850f370fd4b9ac32b8dcbc69a9e5))
* **grove:** address PR review findings for errors.ts ([683efdf](https://github.com/ferueda/grove/commit/683efdf57b126dc88a1150fe9703db5173ecfdb0))
* **grove:** address PR review findings for hooks.ts ([4a5dd0a](https://github.com/ferueda/grove/commit/4a5dd0a6c6c5083d3e5e0b73454d3c51b3062dd1))
* **grove:** address PR review findings for index.ts ([7a1c5cd](https://github.com/ferueda/grove/commit/7a1c5cd6abce43470a92b6b8174c3d6ed7fa508f))
* **grove:** address PR review findings for pool.ts ([19d5873](https://github.com/ferueda/grove/commit/19d5873488bb1e08d5e5c9c6ea7862ffdda3b6d8))
* **grove:** address PR review findings for schemas.ts ([8c27e8c](https://github.com/ferueda/grove/commit/8c27e8cfb7a56ff32a1df849ac86fea68a8739f5))
* harden v1 lease recovery ([52b6344](https://github.com/ferueda/grove/commit/52b6344a62ae44f95a6fa17bb4f1aa859675cda9))
* harden v1 lease recovery ([2043cbd](https://github.com/ferueda/grove/commit/2043cbd929fff01a7c8caf90126f784c2e6d8fba))
* implement review feedback for pool.ts ([04ab56e](https://github.com/ferueda/grove/commit/04ab56ebc4f133ae4a8181df3f447e993751c604))
* tighten lease acquire reacquire and hook failure handling ([6155dde](https://github.com/ferueda/grove/commit/6155ddef1fa468164e91e67cd2a363bdfeb6b449))
* validate leaseId at API boundary before state writes ([612b95c](https://github.com/ferueda/grove/commit/612b95c43d1b459dbe11ed5f96e8eb8b6fada69e))
* validate leaseId at Grove API boundary before state writes ([89006cc](https://github.com/ferueda/grove/commit/89006cca432decc94d0b38de9fc2dae9280512c0))

## [1.0.0](https://github.com/ferueda/grove/compare/grove-v0.3.0...grove-v1.0.0) (2026-06-13)


### ⚠ BREAKING CHANGES

* **lease-first API cutover** — Grove v1 is a breaking rewrite of the public SDK surface.
  * `acquire()` now requires `{ leaseId, mode, ref? }`; no-arg acquire is removed.
  * `release(leaseId, options)` and `destroy(leaseId)` are leaseId-only; path-based release/destroy removed.
  * `list()`, `inspect()`, and `repair()` replace `listLeases`, `listWorktreeStatus`, and `destroyAll`.
  * Removed types: `AcquiredSlot`, `WorktreeStatus`.
  * State machine is transition-driven with crash-recoverable acquire, release WAL, destroy, and repair.


### Features

* add lease and slot transition helpers with joint invariants ([2fbd270](https://github.com/ferueda/grove/commit/2fbd27088f5e417062204d953b43e64fe281a879))
* add lease-first state parse, read, write, and legacy migration ([fb913ba](https://github.com/ferueda/grove/commit/fb913ba80e0e94570ae1d3d02b909dbd734c415b))
* add lease-first v1 error codes and classes ([46aad01](https://github.com/ferueda/grove/commit/46aad01232b7aa86affd7517408051bfec95f5c5))
* add lease-first v1 Zod schemas for slots and leases ([0d5c9a2](https://github.com/ferueda/grove/commit/0d5c9a21e22846a9d4a793230800a5f13bcf3834))
* export lease-first v1 schemas, transitions, and state APIs ([7a50e08](https://github.com/ferueda/grove/commit/7a50e08a4d227fae889c8d9607ccaab8a0736f8c))
* implement v1 lease acquire, inspect, and list ([ab5277e](https://github.com/ferueda/grove/commit/ab5277e3ed7b2cffa3390fa7981fb55de77cffc3))
* implement v1 lease destroy with path safety and resume ([b5c575b](https://github.com/ferueda/grove/commit/b5c575ba6b15c100274c83d33b711c592731b132))
* implement v1 lease release with ReleaseResult and resume-cleanup ([6c41dcd](https://github.com/ferueda/grove/commit/6c41dcd3eb678fe5283d137e1284a74bd65b0c62))
* implement v1 repair matrix and mutator enforcement ([d494451](https://github.com/ferueda/grove/commit/d49445146207d10110d98ac24b0db9ac5fe2b251))
* lease-first v1 PR 1 — schemas, transitions, and state loader ([47c90f0](https://github.com/ferueda/grove/commit/47c90f089d72bfba748a08598e612a6845d3a259))
* v1 lease acquire, inspect, and list (PR 2) ([a97762c](https://github.com/ferueda/grove/commit/a97762c98da8e4ac815a7cb52a46340dfd6e5df9))
* v1 lease destroy with path safety (PR 4) ([b275eb8](https://github.com/ferueda/grove/commit/b275eb8719cceecdfcc37e39a94f6e420d1e1ef2))
* v1 lease release with ReleaseResult (PR 3) ([f3962fd](https://github.com/ferueda/grove/commit/f3962fd47649829fb36fd162af48d839ca1a0f0a))
* v1 lease repair matrix and mutator enforcement (PR 5) ([5bbf69d](https://github.com/ferueda/grove/commit/5bbf69dd886f0503c363d57587753c3ec3809b4e))
* v1 lease-first API cutover and CLI JSON envelopes ([1860c63](https://github.com/ferueda/grove/commit/1860c63c16527bc95dbfa9c6313d579a46f53c8a))
* v1 lease-first API cutover and CLI JSON envelopes (PR 6) ([9e3e177](https://github.com/ferueda/grove/commit/9e3e17798f2776de543f36bc0386d2347f11f4c6))


### Bug Fixes

* address lease recovery review nits ([12e5610](https://github.com/ferueda/grove/commit/12e5610b4d3a440c2accbe2f5c4e65e5e2d9d7be))
* address PR [#45](https://github.com/ferueda/grove/issues/45) review — timing parser and fetch default test ([024ebd1](https://github.com/ferueda/grove/commit/024ebd1709405452cafc810b6a46a21a72111831))
* address PR 4 destroy review findings ([606264c](https://github.com/ferueda/grove/commit/606264c08ab3e526d3a14fac57a3f169c75906b1))
* apply PR 3 review fixes and document PR 4 deferrals ([d1f4aa8](https://github.com/ferueda/grove/commit/d1f4aa8349f80216a9ea08f55fde069445a58ae3))
* clear slot owner fields on quarantine repair ([726b8f5](https://github.com/ferueda/grove/commit/726b8f5cd007c0b4b731d9479c964428b74da45b))
* enforce leaseId-only destroy and post-hook path consistency ([b6bf96c](https://github.com/ferueda/grove/commit/b6bf96c77283096af4689ca0dcce1d4184e84278))
* fresh reset safety scan and typed release state errors ([551a37f](https://github.com/ferueda/grove/commit/551a37f62204850f370fd4b9ac32b8dcbc69a9e5))
* harden v1 lease recovery ([52b6344](https://github.com/ferueda/grove/commit/52b6344a62ae44f95a6fa17bb4f1aa859675cda9))
* harden v1 lease recovery ([2043cbd](https://github.com/ferueda/grove/commit/2043cbd929fff01a7c8caf90126f784c2e6d8fba))
* tighten lease acquire reacquire and hook failure handling ([6155dde](https://github.com/ferueda/grove/commit/6155ddef1fa468164e91e67cd2a363bdfeb6b449))
* validate leaseId at API boundary before state writes ([612b95c](https://github.com/ferueda/grove/commit/612b95c43d1b459dbe11ed5f96e8eb8b6fada69e))
* validate leaseId at Grove API boundary before state writes ([89006cc](https://github.com/ferueda/grove/commit/89006cca432decc94d0b38de9fc2dae9280512c0))

## [0.3.0](https://github.com/ferueda/grove/compare/grove-v0.2.0...grove-v0.3.0) (2026-06-12)


### Features

* **grove:** update branch.ts for lease mode ([c7fdd9b](https://github.com/ferueda/grove/commit/c7fdd9b1e0f9e768793df652acfdd2cf73c8543c))
* **grove:** update detect.ts for lease mode ([998d01d](https://github.com/ferueda/grove/commit/998d01dda76b45176cd2340483b66700a12249e6))
* **grove:** update errors.ts for lease mode ([36dbfc3](https://github.com/ferueda/grove/commit/36dbfc3390a37fe1e7288115d2cf9ce9a24b0a32))
* **grove:** update hooks.ts for lease mode ([c81a403](https://github.com/ferueda/grove/commit/c81a4036006d3e88665cfe0c66d3692f6da82934))
* **grove:** update index.ts for lease mode ([2a74eaf](https://github.com/ferueda/grove/commit/2a74eaf1b3ab26cfaebe9c3974ce1f503d9c8628))
* **grove:** update pool.ts for lease mode ([4b5728d](https://github.com/ferueda/grove/commit/4b5728d340d7f1d90f47c6050e377f8839a28cde))
* **grove:** update schemas.ts for lease mode ([f6e9eb3](https://github.com/ferueda/grove/commit/f6e9eb332829c2dfe0d0226ef1170054aaf8c064))
* **grove:** update state.ts for lease mode ([71e7509](https://github.com/ferueda/grove/commit/71e7509d4edbde14d7032f7cf7713bccf860c8f7))
* **grove:** update terminate.ts for lease mode ([1f55d17](https://github.com/ferueda/grove/commit/1f55d17adcd1a387b0ab0444fac303a6961b5e19))
* implement lease mode ([c2545c0](https://github.com/ferueda/grove/commit/c2545c0cfb1d83acf6bf726fb1485b70e9ff2932))


### Bug Fixes

* **grove:** address PR review findings for errors.ts ([683efdf](https://github.com/ferueda/grove/commit/683efdf57b126dc88a1150fe9703db5173ecfdb0))
* **grove:** address PR review findings for hooks.ts ([4a5dd0a](https://github.com/ferueda/grove/commit/4a5dd0a6c6c5083d3e5e0b73454d3c51b3062dd1))
* **grove:** address PR review findings for index.ts ([7a1c5cd](https://github.com/ferueda/grove/commit/7a1c5cd6abce43470a92b6b8174c3d6ed7fa508f))
* **grove:** address PR review findings for pool.ts ([19d5873](https://github.com/ferueda/grove/commit/19d5873488bb1e08d5e5c9c6ea7862ffdda3b6d8))
* **grove:** address PR review findings for schemas.ts ([8c27e8c](https://github.com/ferueda/grove/commit/8c27e8cfb7a56ff32a1df849ac86fea68a8739f5))

## [0.2.0](https://github.com/ferueda/grove/compare/grove-v0.1.2...grove-v0.2.0) (2026-06-11)


### Features

* **grove:** add package.json ([03f2441](https://github.com/ferueda/grove/commit/03f2441087b0a340746cf6c4eb8a3ca5419b82dd))
* **grove:** add tsconfig.json ([40e8084](https://github.com/ferueda/grove/commit/40e8084f2f7fd5e056a69eb0068f3b82fc137557))
* monorepo migration & CLI wrapper ([89e6a20](https://github.com/ferueda/grove/commit/89e6a2029e98a27bd37cd0cb953c60eab7485a2d))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([5a499b9](https://github.com/ferueda/grove/commit/5a499b960a7801198574c699b444c8b451ed01ab))
* scope packages to [@ferueda](https://github.com/ferueda) to publish to npm ([16ff72f](https://github.com/ferueda/grove/commit/16ff72fffb1e074c6a6713b9b70c4869482d2767))


### Bug Fixes

* add publishConfig access public to allow changesets to publish scoped packages ([b188d60](https://github.com/ferueda/grove/commit/b188d6072ed2ee5fb6a1bc6f59c92e397b549dc0))
* add repository field to package.json for OIDC provenance ([2545591](https://github.com/ferueda/grove/commit/2545591bb5fdb4b20e3d1ab7e3d2d082f5055b58))
* correct workspace typechecking paths ([adc8e22](https://github.com/ferueda/grove/commit/adc8e22919547bbc393b2b9e0dcdcb5907e0cb44))
* declare missing execa dependency and fix test typings ([0735b1d](https://github.com/ferueda/grove/commit/0735b1d08db5ebb7df8b9b83978c0af18fb9bcdd))
* implement review feedback for pool.ts ([04ab56e](https://github.com/ferueda/grove/commit/04ab56ebc4f133ae4a8181df3f447e993751c604))

## 0.1.2

### Patch Changes

- [#21](https://github.com/ferueda/grove/pull/21) [`64c144d`](https://github.com/ferueda/grove/commit/64c144d66cb8bcd0f7b23fab07641c0ec686dbff) Thanks [@ferueda](https://github.com/ferueda)! - fix: add shebang to CLI entry point

## 0.1.1

### Patch Changes

- [`975f6c2`](https://github.com/ferueda/grove/commit/975f6c2eecf7105832b7fdc5802c5d390c700a5a) Thanks [@ferueda](https://github.com/ferueda)! - Automated release pipeline setup and initial configuration for NPM publishing
