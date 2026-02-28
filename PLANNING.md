# Subreddit Activity Lens - UX/Resilience Notes

This file captures the current UX plan and resilience considerations for the public extension.

## 1) Settings Model (No Surprise Network)

- **Auto-scan (default ON):** When a username comes into view, automatically fetch and render badges.
- **Hide badges (default OFF):** Purely visual, but we treat it as a safety switch:
  - When ON, we pause auto-scan and hide injected UI.
  - When OFF again, the user can re-enable auto-scan explicitly.
- **Show hidden profile indicator (default ON):** Controls the 😎 marker only.

## 2) Manual Mode UX (Auto-scan OFF)

- Extension continues to detect usernames and can render cached badges.
- If a username has no cached badge yet, render a same-size pill: **Scan**.
- Clicking **Scan** fetches only that user and swaps to `loading…` then badges.
- Popup also offers **Scan current page** (manual batch scan).

## 3) Popup UX (User-Facing Controls)

Planned (and being implemented):

- Checkbox: **Auto-scan**
- Checkbox: **Hide badges**
- Checkbox: **Show hidden profile indicator**
- Button: **Scan current page**
- Diagnostics: **In-flight count** + **Cancel in-flight**

## 4) Resilience Under Heavy Scrolling

- Viewport-only mounting is the primary protection against massive work.
- When 429s happen, show a clear state and avoid leaving permanent `loading…`.
- Add explicit **Cancel in-flight** to let users stop backlog immediately.
- Special case: the right-sidebar **Moderators** pane is always manual-only (shows **Scan** pills, never auto-fetches).

## 5) Stress Testing (Playwright)

Two levels:

- **Quick/manual:** scroll a large thread and observe UI states + error handling.
- **Automation:** load unpacked extension in Playwright and assert UI/behavior.

Notes:

- Chrome disables extensions in headless mode. For headless rate-limit reproduction (429s) without loading the extension,
  use `chrome_extensions/reddit-snark-sniper/tools/stress-throttle.mjs`.
