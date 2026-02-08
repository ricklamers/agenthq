## Mobile software keyboard does not appear when tapping xterm.js terminal

### Problem

On mobile devices, tapping the xterm.js terminal surface does not raise the software keyboard. The user must already have the keyboard open (from another input) to type into the terminal.

When the keyboard IS open and the user types, xterm.js correctly adjusts so the bottom of the terminal appears directly above the keyboard. But there is no way to trigger the keyboard by tapping the terminal itself.

### What we tried

1. **`terminal.focus()` on tap** - Called xterm's focus method during touchend for taps (no drag). The hidden `xterm-helper-textarea` receives focus, but mobile browsers do not show the keyboard for it.

2. **Sending a character through stdin (`onDataRef.current?.('\0')` / `'a'`)** - The character arrives at the remote process (confirmed by seeing `a` in output), but this does not trigger the keyboard since it bypasses the browser's input pipeline entirely.

3. **Repositioning xterm's helper textarea** - Temporarily moved `.xterm-helper-textarea` to `position:fixed; left:0; top:0` with 1x1px dimensions and `opacity:0.01` before calling `.focus()`, then restored styles on the next animation frame. Mobile browsers still did not show the keyboard.

### Root cause (suspected)

Mobile browsers (iOS Safari, Android Chrome) only show the software keyboard when a **native user gesture** (tap/click) directly focuses an input/textarea element. xterm.js's `.xterm-helper-textarea` is styled in a way that mobile browsers do not consider it a valid focus target for keyboard activation (offscreen positioning, zero opacity, or similar). Programmatic focus via `terminal.focus()` or direct `.focus()` on the textarea — even within a synchronous touch event handler — does not satisfy the browser's heuristics for raising the keyboard.

### Constraints

- The touch surface event handlers (`onSurfaceTouchStart/Move/End`) are needed for custom scroll behavior and cannot be removed.
- xterm.js internally manages its helper textarea positioning and styles, so persistent overrides may conflict with its rendering.
