# Maintenance Guide (Subreddit Activity Lens)

This is a plain-JS MV3 Chrome extension that runs on `reddit.com` and injects:

- `posts | comments` quick links next to user timestamps
- A row of "activity chips" showing the user's top subreddits for the last 30 days

## Data Sources (Adapters)

### Adapter 1 (A1) - Listing JSON

Endpoint:
- `GET https://www.reddit.com/user/<u>/overview.json?limit=100[&after=...]`

Failure modes:
- Hidden profiles can return empty `children`.
- Gated/limited listings (blocked/facade) can yield misleading "no activity" within the window.

### Adapter 2 (A2) - Shreddit Search Partials

Endpoints:
- `GET https://www.reddit.com/svc/shreddit/user/<u>/search/?q=+&type=comments&sort=new&t=month`
- `GET https://www.reddit.com/svc/shreddit/user/<u>/search/?q=+&type=posts&sort=new&t=month`

Pagination:
- Follow `faceplate-partial[src*="cursor="]` links embedded in the partial response HTML.

Notes:
- Responses are HTML partials (`text/vnd.reddit.partial+html`), not JSON.
- We parse result links and treat them as "recent activity signals".

## Caching

The extension caches non-empty snapshots for 12 hours in Chrome `storage.local` to reduce requests.

## When It Breaks

- If you hit `429 Too Many Requests`, wait a bit and/or reload; the UI will show a retry affordance when rate-limited.
- If search pagination markup changes, the most likely file to adjust is `core/search-source.js`.
