# Epistack deployment handoff

New account deployment succeeded: https://epistack-question-lab.aditya297292.chatgpt.site

- Hosted question entry: `/decompose-live`.
- Navigable eggs example: `/examples/eggs-decomposition.html`.
- Current access is public, explicitly requested by the owner and verified through Sites access configuration.
- Lyra credentials are configured as server secrets. No credentials are included in this handoff.
- Local standalone execution completed all three decomposition stages. Its original and preserved outputs are under `decomposition-comparison/`.
- Hosted decomposition has not been verified end to end: browser automation was rejected by automatic approval review because of a usage-limit block.
- The hosted route saves stages in D1, polls durable Lyra response IDs, validates each result, and stops before contextualization/research. It currently caps creation at ten investigations per rolling day across the site.
- Existing research still requires the local Claude companion. The new route does not turn the full investigation workflow into a hosted service.
- Local fixes preserve five alternatives per dimension and reserve one exact cue for each valid dimension. The live eggs run changed from 28 to 34 alternatives and from five to seven traces after reassembly.
- Build passed. Of 80 tests, 79 initially passed; the missing `.env.example` was restored and all nine tests in the affected file passed. TypeScript checking remains non-clean due to existing project errors and missing Cloudflare ambient types.
- Source was pushed to the new Sites repository from `/private/tmp/epistack-current-account`, commit `56344d70b06749a9a8fd78da35d902576b094702`. The main workspace preserves existing uncommitted work; its hosting binding now points to the new project. The old binding is recorded in `previous-hosting.json`.

Next: owner opens the hosted page, submits one question, verifies all three stage transitions and JSON export, then decides public access. Do not claim hosted acceptance or public availability before those checks. Do not generate a sign-in bypass token or retry the rejected browser operation without resolving its approval block.
