# claude.ai write calls (captured 2026-10-29)

Nathan did each action once by hand in Chrome. A page-side recorder logged what the claude.ai web app sent. Session and auth header values aren't recorded here.

All three calls are same-origin `fetch` from `https://claude.ai`, with `content-type: application/json`. The web app also sends its usual `anthropic-*` client headers: platform, build, version and device ID.

## Rename a chat

```
PUT /api/organizations/{org}/chat_conversations/{chat_uuid}
{"name": "<new name>"}
```

- **Response:** `202`, with the full conversation object.
- **`updated_at` in the response was unchanged** by the rename, at least in that response. The 202 may mean the save completes asynchronously, so recheck the list later (Task 9).

## Move chats to a project, or out of one

```
POST /api/organizations/{org}/chat_conversations/move_many
{"conversation_uuids": ["<chat_uuid>", ...], "project_uuid": "<project_uuid>" | null}
```

- **Response:** `200`, `{"moved": [...], "failed": [...], "failed_reasons": {...}}`.
- `project_uuid: null` removes a chat from its project. This was seen on the way back.
- **Takes a list**, so a bulk move is one call.
- **This call does bump the chat's `updated_at`.** It moved to the time of the "remove from project" call.

## Save sidebar settings (groups)

```
PUT /api/claude_code/organizations/{org}/user_settings
if-match: <checksum from the last GET or PUT, e.g. "sha256:…">
{"entries": {"ccd/dframe-store": "<JSON string>", ...}}
```

- **Response:** `200`, `{"checksum": "sha256:…", "lastModified": "…"}`.
- Each save's `if-match` was the previous save's returned checksum, so concurrency is optimistic. A stale checksum is expected to be rejected, probably with `412` (not observed).
- `version` went from 43 to 46 across 3 saves.
- **Body details are unknown.** The recorder clipped bodies at 4,000 characters, so we can't tell:
  - whether the web app sends only the changed entry or all entries;
  - whether any other top-level keys follow `entries`.
- **Ruling:** the extension sends **all** entries it read, with `ccd/dframe-store` replaced. That's safe whether the server merges or replaces.
- **Insertion order** of a moved chat within a group wasn't visible. The sidebar sorts groups by recency, so position doesn't matter. The extension puts moved chats first.
