# Claude Chat Organizer

A Chrome extension with its own tab. It shows every active claude.ai chat with its sidebar group, project, start date and last-used date. From that tab you can:

- **File chats in bulk** into groups and projects.
- **Rename chats** to `last used - topic - started`, for example `10/1/26 - Project API - 3/1/26`.

Changes are saved to your claude.ai account, so they also show in the Claude desktop app and on your phone.

> This uses claude.ai's **unofficial internal API**. It can stop working after a claude.ai update. If it does, it stops and shows an error rather than guessing.

## Install

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder in this project.
4. Pin **Claude Chat Organizer** from the puzzle-piece menu, then click its icon to open the organizer tab.

You need to be signed in to claude.ai in this Chrome profile. The organizer talks to claude.ai through an open claude.ai tab. If none is open, it opens one in the background.

## Use

- **Counts:** active chats, unfiled (in neither a group nor a project), in a group, in a project.
- **Filters:**
  - search;
  - **All / Unfiled / Not renamed / Stale**, each button showing its count:
    - "Not renamed" means the name doesn't yet carry both dates.
    - "Stale" means it was dated before, but the dates no longer match. For example, you've used the chat since. Stale names show **in red**; hover to see what they'd become;
  - group and project dropdowns. "No group" and "No project" are options too.
  - Projects that share a name show a chat count, so you can tell them apart.
- **Right-click a chat** to pick a group or project for it, or to open it in claude.ai.
  - Its current group and project are ticked.
  - Right-clicking one of several ticked chats applies to all of them.
  - **Pinned chats** are tagged "pinned". claude.ai's sidebar shows a pinned chat only under Pinned, even when it's in a group. The group is still saved, and the chat appears there once you unpin it.
- **Tick chats** to get the bulk bar:
  - **Move to group / Remove from group:** one save of your sidebar layout.
  - **Move to project / Remove from project.**
  - **Rename selected:** previews and renames just the ticked chats.
- **Update stale names:** opens the same preview, but only for the red names.
- **Refresh names:**
  - Shows every name that would change, old → new. "check" marks names that had only one of the two dates. It also lists what's skipped, and why.
  - **Apply renames** runs oldest-activity first, one chat at a time.
  - Running it again later only updates names whose last-used date moved.
- **Last used** is the time of the chat's newest message, so a rename never counts as activity.
  - The first open checks every chat. After that, only chats that changed are rechecked.
  - Italic dates are approximate. Those chats aren't renamed.
- **What's skipped:** shared, archived, temporary and untitled chats are never renamed.

## Safety

- **Backups:**
  - Before every group change, the current sidebar layout is saved, keeping the last 20.
  - The first time you ever change a group, a backup file also downloads.
  - **Export backup** downloads the newest one again.
- **Restore last backup** puts back which chats were in which groups. Groups you created since, and other sidebar settings, are kept.
- **Undo last batch** reverts the last rename or project batch, keeping the last 10. It skips chats you've changed by hand since.
- **Checked saves:** a group change is checked after saving. If the Claude desktop app overwrote it, you'll see a message.
  - Tick **"Remind me to close the Claude desktop app before filing"** if that keeps happening.

## Contributing

Forks are welcome under the MIT License. This repository doesn't accept pull requests. To report a bug, open an issue.

## License

[MIT](LICENSE) © 2026 Nathan Bacheller. Not affiliated with or endorsed by Anthropic.

## Develop

- `npm test`: unit tests for naming, group-store edits, the activity cache, undo and helpers (Node 24).
- `npm run dev`: mock mode at `http://localhost:8765/organizer.html?mock=1`, with fixture data and no claude.ai calls.
- `docs/superpowers/specs/`: the design. `docs/superpowers/plans/`: the build plan. `docs/write-calls.md`: the captured claude.ai calls.
