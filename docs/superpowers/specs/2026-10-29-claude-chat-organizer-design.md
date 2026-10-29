# Claude Chat Organizer: design

Date: 2026-10-29
Owner: Nathan

## Why this exists

Nathan has about 380 active chats on claude.ai. He organizes them two ways, both built into claude.ai:

- **Projects:** a chat can belong to one project ("Change project").
- **Sidebar groups:** his own sections, such as Client Deals, Strategy, Product, Volunteering, General, Technical, Side Project and Archive ("Move to group").

Both are filed one chat at a time from a right-click menu. The All Chats page ("View all", `claude.ai/recents`) doesn't show a chat's group or project. So he can't see what's filed where, or find the chats he never filed. As of 2026-10-29, 206 of 380 chats are in neither a group nor a project.

Chat names also don't say when a chat started or when it was last used. He wants that in the name itself, so it shows everywhere: sidebar, All Chats, desktop app, phone.

## What success looks like

- He opens one page and sees every active chat with its group, project, start date and last-used date.
- He can pull up the unfiled chats and file a batch of them into a group or a project in a few clicks.
- He presses one button and every chat is named `last-used - topic - started`. He sees a preview first. Running it again later only updates what changed.
- His sidebar groups in the Claude desktop app still look exactly as before, apart from the changes he asked for.

## Goals

1. **Organizer page.** A tab in Chrome, opened from a toolbar icon, laid out as in the approved mockup:
   - **Counts:** active chats, unfiled (highlighted), in a group, in a project.
   - **Filters:** a search box, an "Unfiled" toggle (chats in neither a group nor a project), a group dropdown and a project dropdown.
   - **Table:** checkbox, chat name, group (colored pill), project (pill), started, last used.
   - **Bulk bar:** appears when rows are ticked. It has "Move to group" (each existing group, plus "Remove from group") and "Move to project" (each project, plus "Remove from project").
   - **Rename preview:** opened by "Refresh names". It shows how many names will change and each change as old name → new name, with an "Apply renames" button.
2. **Date names.** The format is `M/D/YY - <topic> - M/D/YY`. The first date is last activity, the second is the start date. Example: `10/1/26 - Project API - 3/1/26`.
   - The topic is the chat's own title. The group and project are **not** added to the name.
   - Re-running is safe. Strip the tool's own leading and trailing dates, then rebuild, so dates never stack up.
   - If Nathan edits the topic himself in claude.ai, the tool keeps his edited topic.
3. **Filing.** The tool itself moves chats into groups and projects, singly or in bulk. Every change shows up in claude.ai and the Claude desktop app, because both read the same account data.

## Non-goals

- Changing the Claude desktop app itself. Nothing runs inside it.
- Inventing a new grouping system. Use claude.ai's own groups and projects.
- Putting group or project names into chat names.
- Deleting, archiving or starring chats.
- Creating or renaming groups or projects (v1). Nathan uses claude.ai's own "New group…" for that, then reloads the organizer.
- A mobile version, or publishing the extension. It's installed unpacked for Nathan only.

## Anti-goals: failure even if it "works"

- **Scrambled or lost sidebar groups.** The groups record also holds the desktop app's whole sidebar layout (see below). Any write that drops, reorders or corrupts something Nathan didn't ask to change is a failure.
- **Dates that lie.** A rename must not count as activity. If renaming makes a chat look "last used today", the feature is broken.
- **Dates stacking up**, as in `10/29/26 - 10/1/26 - Topic - 3/1/26 - 3/1/26`.
- **Silent bulk changes.** No rename or filing happens without Nathan seeing what will change first. A batch move counts as seen, because he ticked the rows and picked the target.
- **Half-applied group writes.** A failure partway through must leave the groups record either fully updated or untouched.

## Constraints

- **Runs in Chrome on claude.ai**, using Nathan's existing claude.ai sign-in. Nathan agreed to this; the desktop app can't take add-ons.
- **Unofficial API.** Everything below is claude.ai's internal API, seen in the browser on 2026-10-29. It's undocumented and can change without notice. The tool must check responses look as expected and stop with a clear message when they don't. It must never guess and write anyway.
- **No hard-coded IDs.** Discover the organization at runtime, e.g. from `GET /api/organizations` or the org ID in the page's own requests.
- **Personal use, one account:** Max plan, about 380 active chats, 8 groups, 9 projects.

## What claude.ai provides (observed 2026-10-29, read-only)

### Chat list

`GET /api/organizations/{org}/chat_conversations_v2?limit=100&offset={n}&archived=false&consistency=eventual`

- Returns `{ data: [...], has_more }`. Four pages of 100 covered all 380 active chats.
- Fields per chat that matter here:
  - `uuid`, `name`, `created_at`, `updated_at`
  - `project_uuid` and `project: { uuid, name }`, which is null when the chat isn't in a project
  - `is_starred`, `is_archived`, `is_temporary`, `is_multiplayer`, `platform` (`CLAUDE_AI`)
- `last_settled_at` and `latest_assistant_output_at` exist, but are null for most chats (318 of 380 for `last_settled_at`). They're not usable as "last activity".

### Messages: true last activity

`GET /api/organizations/{org}/chat_conversations/{uuid}?tree=False&rendering_mode=messages`

- Returns `chat_messages[]`, each with a `created_at`.
- The newest message's `created_at` is the real last-activity time.
- For one chat checked, it matched `updated_at` to within a second. `updated_at` will probably move on rename (not yet confirmed), so use the message time.
- These responses can be large: one chat had 241 messages.

### Projects

The sidebar called `GET /api/organizations/{org}/projects?include_harmony_projects=true&limit=30&starred=true&with_own_projects=true`. That's a starred subset. The builder needs the call that returns all of Nathan's projects. The distinct `project.name` values in the chat list are a cross-check that the listing is complete.

### Groups: one shared settings record

`GET /api/claude_code/organizations/{org}/user_settings`

- Returns `{ userId, version, lastModified, checksum: "sha256:…", content: { entries: { … } } }`.
  - `version` was 43 on 2026-10-29. It's incremented on save.
- `content.entries["ccd/dframe-store"]` is a **JSON string**. Parsed, it is `{ state: {...}, updatedAt, version: 1 }`.
- The relevant parts of `state`:
  - `customGroups`: `[{ id: "cg-<uuid>", name }]`. These are the 8 groups.
  - `customGroupAssignments`: `{ "chat:<uuid>": "cg-<uuid>" }`. Each chat is in at most one group.
  - `customGroupOrder`: `{ "cg-<uuid>": ["chat:<uuid>", ...] }`, the display order within each group.
  - `sidebarSections`: `[{ id, kind, v: 2, name, order, sortBy, ascending, show: {...}, collapsed, shown, members?: [...] }]`.
    - `kind` is `pinned`, `routines`, `manual`, and so on.
    - Manual sections have `id` equal to the group's `cg-` ID and a `members` list of `"chat:<uuid>"`.
  - Other keys, including `pinnedOrder`, `navPinnedIds`, `groupByByMode`, `recentsStatusFilter` and more. **These must be preserved untouched.**
- **Group membership is stored three times:** in `customGroupAssignments`, in `customGroupOrder`, and in the group's `sidebarSections[].members`. A move must update all three consistently. That means removing the chat from its old group in all three places, and adding it to the new group in all three.
- Members aren't only chats. `cowork:<id>` entries also appear, and must be left alone.
- `content.entries` holds other keys besides `ccd/dframe-store`, such as `ccd/session-presets` and `ccd/dframe-starred-*`. **Preserve them byte-for-byte.**
- The Claude desktop app reads and writes this same record. That's why groups sync between the desktop app and Chrome.

### Write calls: not yet observed

None of these have been seen yet:

- renaming a chat
- changing a chat's project or removing it from one
- saving `user_settings`

**The builder must capture each one before writing code that uses it.** Do that by watching the network while Nathan does each action once by hand in Chrome:

1. Rename one chat.
2. Change one chat's project.
3. Move one chat to a group.

Copy the method, URL, body shape, required headers, and how the settings save handles `version` and `checksum`. Don't guess these.

## Decisions Nathan made

- Organize from Chrome on claude.ai. Changes appear in the desktop app because the data is account-wide.
- Dates go into the chat names, refreshed when he runs the tool.
- Name format: `last activity - topic - started`, with the topic left as the chat's own title.
- The tool files chats into groups and projects itself, including in bulk. It backs up first and is tested on a single chat with him before any bulk use.
- The page layout in the mockup: counts, filters, table, bulk bar, rename preview.

## Calls I made (Claude). Nathan can override any of these.

- **Chrome extension (Manifest V3) with its own tab page**, opened from the toolbar icon, rather than a userscript injected into claude.ai pages.
- **Where API calls run.** If calls from the extension page don't carry the claude.ai sign-in, or get blocked, run them from a content script in an open claude.ai tab and message results back. Calls can fail from an extension origin because of cookies or bot protection.
- **"Last used"** is the newest message's `created_at`.
  - Cache it per chat, keyed by that chat's `updated_at`, so only changed chats are re-fetched. The first run fetches all 380; later runs are fast.
  - If a chat's message fetch fails, show its `updated_at` marked as approximate, and skip renaming that chat.
- **Dates** use Nathan's local time zone, `M/D/YY`, no leading zeros.
- **Which chats get renamed:** active (non-archived) chats only.
  - Skip temporary chats.
  - Skip shared or multiplayer chats (`is_multiplayer`), because a rename would show for other people.
  - Skip chats that don't have a title yet.
  - Pinned or starred chats are treated like any other chat.
- **Stripping old dates.** Strip the tool's own pattern only: `^\d{1,2}/\d{1,2}/\d{2} - ` at the start and ` - \d{1,2}/\d{1,2}/\d{2}$` at the end.
  - Strip each one independently, so a name left with only one date still rebuilds cleanly.
  - In the preview, mark names where only one of the two was found, so Nathan can eyeball them.
  - Dates anywhere else in a title are part of the topic.
- **Organization:** use the one claude.ai itself is using, from the page's own requests or the active-org cookie. Show its name in the page header.
- **Mockup:** the layout is the Goals list above, so no separate file is needed. It was shown in the brainstorming conversation, and the Goals list matches it.
- **The "routine"** is the on-demand "Refresh names" button. There's no automatic schedule in v1.
- **Group-write safety:**
  - Re-read `user_settings` right before every write, and apply the change to that fresh copy.
  - Save it the way the observed save call does, including any version or checksum handling.
  - If the save is rejected as out of date, re-read and retry once. If it fails again, stop and tell Nathan.
  - A bulk group move is one settings write, not one write per chat.
- **Backups:**
  - Before every settings write, keep the full `user_settings` response in extension storage. Keep the last 20.
  - Add an "Export backup" button that downloads the JSON.
  - Before the first group write ever, export a backup automatically.
- **"Restore last backup" restores group membership only.** It replaces the three membership places (`customGroupAssignments`, `customGroupOrder`, `sidebarSections[].members`) in the *current* record with the backup's values.
  - For groups that no longer exist, it drops their memberships.
  - Everything else in the current record is left as it is, so groups or layout changes Nathan made after the backup survive.
- **Undo for renames and project moves.** Keep a change log of each batch: chat ID, old name, new name, old project, new project.
  - "Undo last batch" puts back the old values for chats the tool changed, and skips any chat whose name or project has changed since.
  - Keep the last 10 batches.
- **Renames and project moves** run one chat at a time with a short pause between, and a progress readout. A failure on one chat is reported, and the rest continue.
- **Group pill colors** are assigned per group and stable between sessions.

## Testing

- **Reads** can be tested freely against Nathan's live account.
- **Writes** are first tested on one chat Nathan picks, in this order:
  1. **Rename it.**
     - Check that the tool's own "last used" date didn't jump.
     - Re-read the chat list and see whether the chat's `updated_at` moved, and whether claude.ai's Recents and sidebar order changed.
     - This is a **go/no-go gate** for bulk renaming. See "Rename side effect" below.
  2. **Move it to a group, with the desktop app open.**
     - Check that the desktop app's sidebar shows the move.
     - Then have Nathan do one ordinary sidebar action in the desktop app, such as collapsing a group or moving a different chat.
     - Re-read the record to confirm the tool's move survived. This shows whether the desktop app saves its own stale copy over the tool's write. See "Desktop app overwrite" below.
  3. **Change its project.**

  Bulk actions only after he confirms those.
- **Rename side effect.** If a rename bumps `updated_at`, claude.ai will show renamed chats as recently used and re-sort them.
  - In that case, bulk renames go oldest-activity first, so claude.ai's order still matches real last activity.
  - Its own "last used" times would still read as the rename time. Nathan accepted this (see below).
- **Desktop app overwrite.** If the desktop app does undo the tool's group writes, the organizer reminds Nathan to close it before each group write. Nathan accepted this (see below).

## Fallbacks Nathan accepted (2026-10-29)

1. **Rename side effect: acceptable.** If renaming bumps `updated_at`, bulk rename still ships, going oldest-activity first. The organizer's preview notes that claude.ai's own times will show the rename time, and the true dates are in the names.
2. **Desktop app overwrite: acceptable.** If the test shows the desktop app overwrites group changes, Nathan closes the desktop app while filing. The organizer then shows a "Close the Claude desktop app before filing" reminder before each group write. After each write it re-reads the record to confirm the change stuck.
- **The naming logic** (build, strip, re-run, user-edited topic) is plain functions with unit tests.
- **The group-move logic** gets unit tests that run against a copy of the real store shape. Those tests confirm:
  - all three membership places stay in sync;
  - `cowork:` members survive;
  - unrelated keys are preserved;
  - a move from group A to group B leaves no trace of the chat in A.

## Left to the builder

File layout, framework choice (plain JS is fine), styling details within the mockup, the cache's storage format, throttle timing, how errors are shown, and how projects are listed.
