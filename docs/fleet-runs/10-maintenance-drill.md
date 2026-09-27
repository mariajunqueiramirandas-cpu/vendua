# Maintenance kill-switch drill — `loja-modelo`

2026-09-27T02:21:11.884Z · artifact `storefronts/_template` · Core http://localhost:8787

| Step                                                       | Result | Observed                                                |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------- |
| kill switch on (PATCH /control/v1/storefronts/:tenant/ops) | pass   | maintenance                                             |
| overlay over a live Kernel                                 | pass   | Voltamos já — Drill: instabilidade — peça pelo WhatsApp |
| overlay on a broken build (bundle aborted, only v.js)      | pass   | Voltamos já — Drill: instabilidade — peça pelo WhatsApp |
| kill switch off → store back                               | pass   | no overlay                                              |

**Drill passed.**
