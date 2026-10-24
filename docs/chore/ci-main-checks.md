# Restore main branch checks

The last main-branch run failed in its unit-test step. Running the complete suite on local commit `a40af516` reproduced 25 failing tests and two test files that could not initialize. The run reported 934 passing files and 10,440 passing tests, with one file and two tests already skipped.

Two architecture violations are repaired rather than added to exception lists:

- Collection import buttons and lyric preparation progress belong to the library UI layer. Both components now live in `src/library/app/collectionImport`; core retains the headless hooks and contracts.
- Applying prepared lyrics patches the existing song through the functional setter, with an identity guard, rather than replacing the current song directly outside the playback coordinator.

Outdated test contracts now reflect the implemented behavior: QQ daily recommendations precede radar; selected-song AI themes supply their own lyric colors/icons; the AI theme action can reuse a cached theme; imported collections are not yet exposed in TUI; and the platform/login inventories include current adapters. Partial storage mocks retain real exports, and restore/search fixtures implement the capabilities used by their production paths. Cancellation, ordering, restoration and platform-boundary assertions remain in place.

The CI root typecheck receives an explicit 6 GiB Node heap. The workflow still runs the complete unit suite and the independent sync-server typecheck; no checks have been disabled or marked optional.

Final local validation passed: 947 test files, 10,573 tests, the root typecheck and the sync-server build/typecheck. The pre-existing one skipped file and two skipped tests remain unchanged. GitHub Actions is checked separately after pushing. This maintenance change keeps version 0.7.21.25 and does not create another Android release.
