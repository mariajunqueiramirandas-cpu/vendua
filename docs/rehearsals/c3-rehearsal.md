# Codemod rehearsal: `c3-rehearsal`

rename system.StorePausedNotice → system.PauseNotice; drop the deprecated `ring` from vendua.config.ts

| Storefront                          | Codemod                                                                                                                          | Typecheck | vendua check | Outcome |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------ | ------- |
| `storefronts/_template`             | changed (vendua.config.ts: removed `ring` (Control Plane data))                                                                  | pass      | pass         | green   |
| `storefronts/quero-pudim`           | changed (vendua.config.ts: removed `ring` (Control Plane data))                                                                  | pass      | pass         | green   |
| `storefronts/_examples/quero-pudim` | changed (vendua.config.ts: system.StorePausedNotice → system.PauseNotice; vendua.config.ts: removed `ring` (Control Plane data)) | pass      | pass         | green   |

**Failure tail: 0/3 (0%).** Budget per 09: 5–15% expected, >20% means fix the codemod.
