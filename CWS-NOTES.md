# CWS Notes

## Deleted/Removed Content Nuance (As Of 2026-02-17)

Badges are built from Reddit's public listing/search surfaces. In some cases, activity can still appear in a user's
`overview.json` (or briefly on-page) even if the underlying post/comment was later deleted/removed or no longer indexed by
Reddit search.

Practical effect:
- A badge may show `1c` / `1p` for a subreddit, but clicking the built-in "posts" / "comments" search links can return
  zero results for that subreddit/user.

This is expected behavior and doesn't necessarily mean the badge is wrong; it usually means the underlying content isn't
searchable anymore.

