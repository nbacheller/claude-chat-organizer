# Claude Chat Organizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension whose organizer tab lists every active claude.ai chat with group, project, start date and last-used date. From it you can file chats into groups and projects in bulk, and rename chats to `last-used - topic - started`.

**Architecture:**
- **Pure logic modules**, unit-tested in Node: naming, group-store edits, activity cache and undo.
- **Extension shell:** a manifest, a background worker that opens the organizer tab, and a bridge. The bridge runs `fetch` inside an open claude.ai tab via `chrome.scripting.executeScript({world: 'MAIN'})`, so requests carry claude.ai's own sign-in and origin.
- **Organizer page:** plain ES modules. A mock mode with fixture data lets the page run outside the extension, for UI checks.

**Tech Stack:** Chrome Manifest V3, plain JavaScript ES modules (no build step, no runtime dependencies), Node 24 `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-10-29-claude-chat-organizer-design.md`

## Global Constraints

- **Name format:** `M/D/YY - <topic> - M/D/YY`. The first date is last activity, the second is the start date. Local time zone, no leading zeros.
- **Strip only the tool's own dates:**
  - leading `^\d{1,2}\/\d{1,2}\/\d{2} - `
  - trailing ` - \d{1,2}\/\d{1,2}\/\d{2}$`
  - Each is stripped independently. Dates anywhere else in a title are part of the topic.
- **Rename only eligible chats:** not archived, not temporary, not multiplayer, and with a non-empty title. Chats whose activity date is approximate are skipped.
- **Last used** is the newest message's `created_at`. It's cached per chat, keyed by `updated_at`.
- **Group membership lives in three places**, which must stay in sync:
  - `customGroupAssignments`
  - `customGroupOrder`
  - the group's `sidebarSections[].members`
  - `cowork:` members and every unrelated key or entry are preserved untouched.
- **Each group write is a single settings save:**
  - re-read the settings first;
  - push a backup (keep 20), and auto-export one before the first-ever write;
  - retry once if the save is rejected as out of date;
  - re-read afterwards to verify.
- **Renames and project moves** run one chat at a time with a 300 ms pause. Each batch is logged for undo, keeping the last 10.
- **Bulk renames** go oldest-activity first.
- **No hard-coded org or chat IDs.** Discover the org at runtime.
- **No write call shape is guessed.** The write calls in Task 7 are built only from the shapes captured in Task 6.
- **UI copy** is sentence case.

## Review Focus

1. **Chat moved from group A to group B:** it must leave no trace in A's assignment, order, or section members. (Task 2 test `move between groups leaves no trace`)
2. **Name already in format:**
   - with only the activity date stale, only the leading date changes;
   - with nothing stale, it's `changed: false` and isn't counted in the preview.

   (Task 1 tests `refresh only updates lead date`, `current name is unchanged`)
3. **Topic with ` - ` or a date in the middle**, e.g. `Q3 plan - 9/30/26 review`: it stays intact. (Task 1 test `mid-title dates are topic`)
4. **Assignment pointing to a deleted group:** it shows as ungrouped, and a later move cleans it up. (Task 2 tests `orphan assignment reads as ungrouped`, `move cleans orphan assignment`)
5. **Timestamp near midnight UTC:** it formats in local time, not UTC. (Task 1 test `formats in local time`)

---

## File structure

```
(project root)
  package.json                 "type": "module", "test": "node --test tests/"
  extension/
    manifest.json
    background.js              opens organizer tab on toolbar click
    organizer.html / .css / .js
    src/naming.js              format, strip, build, eligibility, planRename, orderForRename
    src/groups.js              read/list/move/restore/write the sidebar store
    src/activity.js            lastMessageAt, resolveLastUsed (cache)
    src/undo.js                makeBatch, planUndo
    src/util.js                capList, groupColor, throttle helpers
    src/bridge.js              runInClaude(func, args)
    src/api.js                 claude.ai reads (Task 4) and writes (Task 7)
    src/storage.js             chrome.storage.local wrappers (cache, backups, batches)
    src/env.js                 picks real or mock api/storage
    dev/mock-api.js, dev/fixture.json, dev/serve.mjs
  tests/
    naming.test.mjs, groups.test.mjs, activity.test.mjs, undo.test.mjs, util.test.mjs
    fixtures/store.json        synthetic sidebar store in the observed shape
  docs/write-calls.md          captured in Task 6
  README.md                    install and use (Task 10)
```

There's no git repo, so there are no commit steps. Each task ends with `npm test` green.

---

### Task 1: Scaffold and naming

**Files:** Create `package.json`, `extension/src/naming.js`, `tests/naming.test.mjs`

**Interfaces (produces):**
- `formatDate(input: Date|string): string`
- `stripToolDates(name: string): { topic: string, lead: boolean, trail: boolean }`
- `buildName(topic: string, lastUsed: Date|string, started: Date|string): string`
- `isRenameEligible(chat): boolean`. Reads `is_archived`, `is_temporary`, `is_multiplayer`, `name`.
- `planRename(chat, activity: {at: string, approx: boolean}|null)`, returning `{ uuid, oldName, newName, changed: boolean, partial: boolean, skip: null|'ineligible'|'no-activity'|'approx-activity'|'empty-topic', lastUsed: string|null }`
- `orderForRename(plans): plans`. Ascending by `lastUsed`.

- [ ] **Step 1: Write failing tests** in `tests/naming.test.mjs`:
  - `formats in local time`: `formatDate(new Date(2026, 9, 1, 23, 59))` is `'10/1/26'`, and `formatDate(new Date(2026, 2, 1, 0, 1))` is `'3/1/26'`.
  - `builds the agreed format`: `buildName('Project API', new Date(2026,9,1), new Date(2026,2,1))` is `'10/1/26 - Project API - 3/1/26'`.
  - `strips both tool dates`: `stripToolDates('10/1/26 - Project API - 3/1/26')` is `{topic:'Project API', lead:true, trail:true}`.
  - `strips a lone date`: `stripToolDates('10/1/26 - Topic')` is `{topic:'Topic', lead:true, trail:false}`.
  - `mid-title dates are topic`: `stripToolDates('Q3 plan - 9/30/26 review').topic` is `'Q3 plan - 9/30/26 review'`. Also, `stripToolDates('AI 1.2 PRD - draft')` has `lead:false, trail:false`.
  - `refresh only updates lead date`: for a chat named `'10/2/26 - Contract review checklist - 8/14/26'` with `created_at` 8/14/26 (local) and activity `{at: <10/21/26 local ISO>, approx:false}`:
    - `newName` is `'10/21/26 - Contract review checklist - 8/14/26'`;
    - `changed` is `true`;
    - `partial` is `false`.
  - `current name is unchanged`: the same chat with activity on 10/2/26 has `changed: false`.
  - `partial flagged`: a name with only a trailing tool date has `partial: true`.
  - `skips`:
    - `is_multiplayer: true` → `'ineligible'`
    - `name: ''` → `'ineligible'`
    - `activity: null` → `'no-activity'`
    - `approx: true` → `'approx-activity'`
    - a name of only `'10/1/26 - '` stripped to empty → `'empty-topic'`
  - `oldest first`: `orderForRename` sorts plans by `lastUsed` ascending.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `naming.js`. Dates are built with `getMonth()+1`, `getDate()`, and `getFullYear()%100` (no padding). `planRename` takes the started date from `chat.created_at`.
- [ ] **Step 4: Run** `npm test`. Expected: all naming tests PASS.

### Task 2: Group store edits

**Files:** Create `extension/src/groups.js`, `tests/fixtures/store.json`, `tests/groups.test.mjs`

**Fixture:** a `user_settings` record shaped as in the spec.
- Top level: `{userId, version: 43, lastModified, checksum, content: {entries: {...}}}`.
- `content.entries` holds:
  - `"ccd/session-presets": "<opaque string>"`
  - `"ccd/dframe-starred-code": "<opaque string>"`
  - `"ccd/dframe-store"`: a JSON string of `{state, updatedAt, version: 1}`
- `state` holds:
  - groups `cg-a` "Client Deals" and `cg-b` "Side Project";
  - assignments `chat:1→cg-a`, `chat:2→cg-a`, `cowork:x→cg-b`, and `chat:9→cg-gone` (an orphan);
  - a matching `customGroupOrder`;
  - `sidebarSections`: `pinned`, `routines`, and manual sections for `cg-a` and `cg-b` with `members`;
  - plus `pinnedOrder: []` and `recentsStatusFilter: "active"`.

**Interfaces (produces):**
- `STORE_KEY = 'ccd/dframe-store'`
- `class GroupsShapeError extends Error`
- `readStore(record): store`. Throws `GroupsShapeError` if any of the four membership or group keys is missing.
- `listGroups(store): Array<{id, name}>`
- `groupIdOf(store, chatUuid): string|null`. Returns null for an orphan assignment.
- `moveChats(store, chatUuids: string[], targetGroupId: string|null): store`. Pure, and returns a new object.
- `restoreMembership(current: store, backup: store): store`
- `writeStore(record, store): content`. Returns a new `content`; other entries are the identical strings.

- [ ] **Step 1: Write failing tests:**
  - `reads groups`: `listGroups` returns the two groups in order.
  - `orphan assignment reads as ungrouped`: `groupIdOf(store,'9')` is `null`.
  - `move into group syncs all three places`: after moving `3` into `cg-b`:
    - `customGroupAssignments['chat:3']` is `'cg-b'`;
    - `customGroupOrder['cg-b']` includes `'chat:3'`;
    - the `cg-b` section's `members` includes `'chat:3'`.
  - `move between groups leaves no trace`: after moving `1` from `cg-a` into `cg-b`, `'chat:1'` is absent from `cg-a`'s order and members.
  - `remove from group`: after `moveChats(store,['2'],null)`, there's no assignment and `chat:2` is in no order or members list.
  - `move cleans orphan assignment`: after moving `9` into `cg-a`, the assignment is `cg-a` and `cg-gone` has no keys.
  - `cowork members survive`: `cowork:x` keeps its assignment, order and members after any move.
  - `unrelated keys preserved`:
    - `pinnedOrder`, `recentsStatusFilter`, and the `pinned`/`routines` sections are deep-equal to the input;
    - `writeStore` leaves the other `entries` strictly equal (`===`).
  - `unknown target throws`: moving into `cg-nope` throws.
  - `input not mutated`: a deep clone of the input taken before the move still equals the input afterwards.
  - `restore keeps current groups`: `restoreMembership(current, backup)`, where `current` has an extra group `cg-c` that's missing from the backup:
    - `cg-c` still exists and its section is unchanged apart from members;
    - memberships match the backup for `cg-a` and `cg-b`;
    - a backup group that's absent from current contributes nothing.
  - `shape error`: `readStore` on a record without `customGroups` throws `GroupsShapeError`.
- [ ] **Step 2: Run** `npm test`. Expected: the groups tests FAIL.
- [ ] **Step 3: Implement** `groups.js`.
  - Use `structuredClone` for purity.
  - Insert moved chats at the front of the order and members lists. Task 7 adjusts this if the captured native move appends instead.
  - Set `updatedAt = Date.now()` on the returned store.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 3: Activity cache, undo, utilities

**Files:** Create `extension/src/activity.js`, `extension/src/undo.js`, `extension/src/util.js`, and their three tests.

**Interfaces (produces):**
- `lastMessageAt(conversation): string|null`. The maximum `created_at` in `conversation.chat_messages`.
- `resolveLastUsed(chat, cache: object, fetchLastAt: (uuid)=>Promise<string|null>): Promise<{at, approx}>`
  - A cache hit is when `cache[uuid].updated_at === chat.updated_at`.
  - On fetch success, write `{updated_at, lastUsed}` to the cache.
  - On failure or null, return `{at: chat.updated_at, approx: true}` and don't cache.
- `makeBatch(kind: 'rename'|'project', changes: Array<{uuid, before, after}>): {id, kind, at, changes}`
- `planUndo(batch, currentByUuid: Map): Array<{uuid, value}>`. Includes only chats whose current value (`name` for rename, `project_uuid` for project) still equals `after`.
- `capList(list, item, max): list`. The newest item goes first, and the list is trimmed to `max`.
- `groupColor(groupId): {bg, fg}`. Uses one of 8 CSS-var pairs, `--tint-N-bg`/`--tint-N-fg`, picked by a stable string hash.
- `mapLimit(items, limit, fn): Promise<results>`. Concurrency-limited map.

- [ ] **Step 1: Write failing tests:**
  - activity:
    - `cache hit skips fetch`: the fetch spy isn't called.
    - `cache miss fetches and stores`.
    - `fetch failure is approximate and uncached`.
    - `lastMessageAt picks newest`, including with unsorted messages.
  - undo:
    - `rename undo skips edited chats`.
    - `project undo restores null`.
  - util:
    - `capList keeps newest 20`.
    - `groupColor stable`: the same ID gives the same pair, and pairs always come from the 8.
    - `mapLimit never exceeds limit`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 4: Extension shell and claude.ai reads

**Files:** Create `extension/manifest.json`, `extension/background.js`, `extension/src/bridge.js`, `extension/src/api.js`, `extension/src/storage.js`, `extension/src/env.js`

**manifest.json:**
- `manifest_version: 3`, name "Claude Chat Organizer", version "0.1.0"
- `action` with title "Open chat organizer"
- `background.service_worker: background.js`, `type: module`
- `permissions: ["storage", "scripting", "tabs"]`
- `host_permissions: ["https://claude.ai/*"]`

**Interfaces (produces):**
- `runInClaude(func, args): Promise<any>`
  - Uses the first `https://claude.ai/*` tab. If there's none, it creates one with `active:false` at `/recents` and waits for `status === 'complete'`.
  - It then runs `executeScript({world:'MAIN', func, args})` and returns `[0].result`. `func` must be self-contained.
- `api.getOrg(): Promise<{uuid, name}>`
  - Page-side: read `GET /api/organizations` and prefer the uuid in the `lastActiveOrg` cookie.
  - Otherwise use the first org whose `capabilities` include `'chat'`.
- `api.listChats(org): Promise<Chat[]>`
  - Page-side paging of `chat_conversations_v2?limit=100&offset=N&archived=false&consistency=eventual`.
  - Return only these fields: `uuid`, `name`, `created_at`, `updated_at`, `project_uuid`, `project`, `is_starred`, `is_archived`, `is_temporary`, `is_multiplayer`.
- `api.getLastMessageAt(org, uuid): Promise<string|null>`
  - Page-side fetch of `chat_conversations/{uuid}?tree=False&rendering_mode=messages`, reduced in the page to the latest message's `created_at`.
- `api.listProjects(org): Promise<Array<{uuid, name}>>`
  - Find the all-projects listing during Step 2. Start from the observed URL without `starred=true`, paging if needed.
  - Fall back to the distinct `project` values in the chat list.
- `api.getUserSettings(org): Promise<record>`. Reads `/api/claude_code/organizations/{org}/user_settings`.
- `storage`, all on `chrome.storage.local`:
  - `getCache()`, `setCache(obj)`
  - `pushBackup(record)` (keeps 20), `getBackups()`
  - `pushBatch(batch)` (keeps 10), `getBatches()`, `popBatch()`
  - `getFlag(name)`, `setFlag(name, value)`
- `env.js` exports `{api, storage, isMock}`. With `?mock=1`, or when `chrome.scripting` is absent, it uses `dev/mock-api.js` and a `localStorage`-backed storage.

- [ ] **Step 1: Write** the manifest, background worker (`chrome.action.onClicked` opens `organizer.html`, or focuses it if already open), bridge, storage and env.
- [ ] **Step 2: Verify the page-side functions live.** Run each `api` page function's body in a claude.ai tab via Claude in Chrome `javascript_tool`. Expected:
  - `getOrg` returns the org Nathan's sidebar uses;
  - `listChats` returns about 380 chats;
  - `getLastMessageAt` returns an ISO string;
  - `listProjects` returns all 9 project names seen in the chat list;
  - `getUserSettings` parses through `readStore` with 8 groups.

  Record the projects URL that worked in `api.js`.

### Task 5: Organizer page (reads)

**Files:** Create `extension/organizer.html`, `extension/organizer.css`, `extension/organizer.js`, `extension/dev/mock-api.js`, `extension/dev/fixture.json`, `extension/dev/serve.mjs`

**Layout** (as in the spec's Goals and the approved mockup):
- **Header:** org name, plus buttons "Export backup", "Restore last backup", "Undo last batch". The buttons are wired in Task 7.
- **Counts row:**
  - Active chats
  - Unfiled (warning tint), meaning neither a group nor a project
  - In a group
  - In a project
- **Filter row:** search, All/Unfiled toggle, group select, project select, and "Refresh names" on the right.
- **Bulk bar** (shown only when rows are ticked): "N selected", a "Move to group" select (groups plus "Remove from group"), and a "Move to project" select (projects plus "Remove from project").
- **Table columns:** checkbox, Chat, Group (pill, colored with `groupColor`), Project (pill), Started, Last used. Approximate dates are italic with the title text "Approximate".
- **Rename preview panel:** in-flow, opened by "Refresh names".
- **Progress line:** "Checking last activity 120 of 380".

**Behavior:**
- On load, fetch the org, chats, projects and settings. Render at once, using cached activity where it exists.
- Then resolve last-used for the rest with `mapLimit(…, 4, …)`, saving the cache every 25 chats.
- Group read errors (`GroupsShapeError`) show a banner, "Couldn't read your sidebar groups. Group features are off.", and disable the group controls. The rest of the page still works.

**Mock mode:**
- `dev/fixture.json` holds about 12 chats covering: grouped, project-only, unfiled, multiplayer, an already-formatted name, a partial name, and an orphan group assignment. It also holds a settings record in the fixture store shape.
- Mock writes log to the console and update the in-memory fixture.
- `node extension/dev/serve.mjs` serves `extension/` on `http://localhost:8765`.

- [ ] **Step 1: Write** the page, styles, mock API, fixture and server.
- [ ] **Step 2: Verify** at `http://localhost:8765/organizer.html?mock=1` in the built-in browser. Expected:
  - the counts match the fixture;
  - Unfiled filters correctly;
  - ticking rows shows the bulk bar;
  - the orphan shows as ungrouped;
  - pills show their colors;
  - it's readable at 1280px and 900px wide, in light and dark mode.

### Task 6: Capture claude.ai's write calls (with Nathan)

**Files:** Create `docs/write-calls.md`

- [ ] **Step 1:** Open a claude.ai tab in Nathan's Chrome via Claude in Chrome. Install a page-side logger that wraps `window.fetch` and records method, URL with the org replaced by `{org}`, request body, response status and response body for non-GET `/api/` calls.
- [ ] **Step 2:** Ask Nathan to do, by hand and in that tab, on a chat he picks:
  1. rename it;
  2. change its project;
  3. move it to a group.

  He then undoes each by hand.
- [ ] **Step 3:** Read the log and record in `docs/write-calls.md`, for each call:
  - the method, URL, body and required headers;
  - for the settings save: how `version` and `checksum` are sent, what a stale-version rejection looks like (status and body) if it can be seen, and whether new members are added at the front or the back.

  Don't record any session tokens.

### Task 7: Write features

**Files:** Modify `extension/src/api.js`, `extension/organizer.js`, and `extension/src/groups.js` (only if insertion order differs), plus `tests/groups.test.mjs` if order changes.

**Interfaces (produces), shapes exactly as in `docs/write-calls.md`:**
- `api.renameChat(org, uuid, name): Promise<Chat>`
- `api.setChatProject(org, uuid, projectUuid|null): Promise<void>`
- `api.saveUserSettings(org, record, content): Promise<record>`. Throws `StaleSettingsError` on a version rejection.

**Behavior:**
- **Refresh names:**
  - Wait for activity to resolve.
  - Build `planRename` for each chat, then show the preview:
    - "N of M names change";
    - old → new for each, with partial ones flagged;
    - skipped counts by reason;
    - the note "claude.ai may show renamed chats as used today. The real dates are in the names."
  - "Apply renames" runs `orderForRename` order, one at a time with a 300 ms pause, showing progress.
  - Failures are listed and the rest continue.
  - Record a `rename` batch, then update the cache's `updated_at` for each renamed chat from the response.
- **Rename selected:** a bulk-bar button. It uses the same preview and apply as "Refresh names", limited to the ticked rows.
- **Move to group:**
  - If the `desktopReminder` flag is set, show the reminder "Close the Claude desktop app before filing." with Continue / Cancel.
  - Then:
    1. re-read the settings;
    2. if the `firstGroupWriteDone` flag is unset, auto-export a backup and set the flag;
    3. `pushBackup`;
    4. `moveChats`, then `writeStore`;
    5. `saveUserSettings`, retrying once on `StaleSettingsError` by going back to the re-read;
    6. re-read and confirm each chat's `groupIdOf` equals the target. If not, show "Your group change didn't stick. Close the Claude desktop app and try again."
- **Move to project:** sequential with a pause, recorded as a `project` batch.
- **Export backup:** downloads the newest backup, or a fresh read if there are none, as `claude-sidebar-backup-<YYYY-MM-DD-HHmm>.json` via a blob link.
- **Restore last backup:**
  - Confirm on the page, not with `window.confirm`.
  - Then: re-read, `restoreMembership(current, newest backup)`, `pushBackup(current)`, save, verify.
- **Undo last batch:** `popBatch`, then `planUndo` against fresh chats, then apply sequentially. Report "Undid N of M. K were changed since and left alone."

- [ ] **Step 1:** Implement the write functions from the captured shapes. If the native move appends, change the insertion in `groups.js` and the test to match.
- [ ] **Step 2:** Implement the four flows above in `organizer.js`.
- [ ] **Step 3: Verify in mock mode.**
  - Preview counts match the fixture: the formatted-but-current chat isn't counted, the partial one is flagged, and multiplayer is skipped.
  - Applying updates the names in the table.
  - Moving to a group updates the pills.
  - Undo restores the names.
  - `npm test` is green.

### Task 8: Install and live read check (Nathan installs)

- [ ] **Step 1:** Nathan installs the extension:
  1. Open `chrome://extensions`.
  2. Turn on Developer mode.
  3. Choose Load unpacked, and pick the `extension/` folder.
  4. Click the toolbar icon.
- [ ] **Step 2: Expected:**
  - the counts are close to 380 / 206 / 33 / 171;
  - the group and project pills match his sidebar for 5 chats he spot-checks;
  - the last-activity progress completes;
  - a second open is fast because it's served from the cache.

### Task 9: One-chat write test and gates (with Nathan)

- [ ] **Step 1: Rename one chat** Nathan picks, using "Rename selected" with one row ticked. Then check:
  - the tool's "last used" is unchanged;
  - whether the chat jumped to the top of claude.ai's Recents. Record the result. Nathan has already accepted it either way, so it's not a blocker.
- [ ] **Step 2: Move that chat to a group with the desktop app open.**
  - Nathan confirms the desktop sidebar shows it.
  - Nathan then collapses or expands a group in the desktop app.
  - The tool re-reads the settings. If the move was lost, set the `desktopReminder` flag on.
- [ ] **Step 3: Change that chat's project.** Nathan confirms in claude.ai.
- [ ] **Step 4:** Undo the rename and project change with "Undo last batch". Move the group back. Nathan confirms everything is as it was.

### Task 10: Handover

**Files:** Create `README.md`

- [ ] **Step 1:** Write the README:
  - install steps;
  - what each control does;
  - the warning that this uses claude.ai's unofficial internal API and may break after a claude.ai update;
  - where backups live, and how to restore;
  - how to run the tests (`npm test`).
