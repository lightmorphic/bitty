# Changelog

## 0.7.9

- Added a paste button next to the magnet link field, since right-click paste doesn't work there.
  Click it to paste a magnet link straight in; if the clipboard doesn't hold one, it shows a small
  "Oops, not a magnet link" tooltip instead of pasting garbage into the field.

## 0.7.8

- Clicking the update dot now visibly pulses while it checks, rather than jumping straight to the
  result with no feedback that anything happened. Once it lands on up to date, a tooltip says so
  and fades out on its own a couple of seconds later, rather than only being visible if you happen
  to still be hovering. The hover tooltip for the up-to-date state is now just "Up to date"
  instead of "Up to date, click to check again".
- Tooltips are now white with dark text instead of a dark bubble with white text, since Bitty's own
  UI is dark: the dark tooltip design is meant for a light-background app and was nearly
  disappearing against Bitty's background.

## 0.7.7

- Icon-only buttons (pause/resume, remove, delete, the update dot, close settings) now show a
  proper styled tooltip on hover instead of the plain OS one. It appears above the button by
  default with the arrow pointing down; near the top of the window it flips to appear below with
  the arrow pointing up instead of running off the screen, and is clamped horizontally too.

## 0.7.6

- Fixed the sidebar header: the version number and status dot had dropped onto their own line
  below "Bitty" instead of sitting next to it on the same line.

## 0.7.5

- The tray icon is now the actual Bitty logo (the checkmark-in-a-ring mark, same as everywhere else
  in the app) instead of a plain flat-colour dot. VPN status still shows the same way: the ring and
  checkmark are green when connected, amber while connecting, red when disconnected, and the
  black-and-white option in Settings is the same mark as a plain white silhouette at varying
  opacity rather than a plain circle.

## 0.7.4

- Fixed a crash on "Quit Bitty" from the tray menu, introduced by 0.7.3's click fix: quitting tore
  down the tray's D-Bus connection before the D-Bus library had finished writing back the reply to
  the very click that triggered the quit, which threw an uncaught write-after-end error and took
  the whole app down with an error dialog instead of exiting. The quit is now deferred by a tick so
  that reply flushes first, and a connection-level error handler means a stray write error like
  this can no longer crash the app outright either way.

## 0.7.3

- Fixed the tray menu rendering correctly (labels visible, right size) but every click doing
  nothing. Confirmed by watching the actual D-Bus traffic while clicking: Cinnamon's menu sends
  clicks through `EventGroup`/`AboutToShowGroup`, a batched pair of methods from the DBusMenu spec,
  not the singular `Event`/`AboutToShow` pair this app only implemented. Those calls were hitting
  undeclared methods and being silently dropped, no error, no click, nothing. Both pairs are now
  implemented and share the same click handling.

## 0.7.2

- Fixed the tray icon's right-click menu showing as a correctly-sized but completely blank grey
  box, no text. The menu structure (item count, layout) was right, but `GetGroupProperties` — a
  second method some menu clients call separately from `GetLayout` to fetch each item's actual
  label — always returned nothing. Cinnamon's tray menu turned out to be one of the clients that
  relies on it. It now returns the real label/enabled/visible data for every item, from the same
  source `GetLayout` uses, so the menu renders correctly regardless of which method a given
  desktop's menu client prefers.

## 0.7.1

- Actually fixed the tray icon this time. 0.7.0's rewrite fixed the D-Bus side but the icon theme
  path it advertised (`IconThemePath`) pointed inside `app.asar`, the packed archive Electron reads
  through transparently for its own code but which is just an opaque file to everything else. The
  desktop's tray watcher is a separate process reading that path directly off disk, so it could
  never see the icon files, and silently fell back to a generic glyph. This only showed up in a
  packaged build, not the dev checkout used to verify 0.7.0, which is how it got through. The icon
  theme is now unpacked from the archive at build time and the path points at the real files.

## 0.7.0

- Fixed the tray icon: it now renders as a real, distinct icon (not a generic fallback glyph) and
  actually responds to clicks. The previous implementation, built on Electron's own Linux tray
  support, silently omitted a property the desktop's tray watcher expects every icon to have, and
  the watcher was treating that as a broken/placeholder item — so clicks never reached it. Replaced
  it with a purpose-built implementation of the two D-Bus interfaces a tray icon needs
  (StatusNotifierItem and DBusMenu) that always sends the full, correct property set. Clicking the
  icon now shows/hides the window, and the right-click menu (Show/Hide, Quit) works too.
- The tray icon now uses the same colour/black-and-white choice from Settings consistently, and
  updates live as the VPN connects, disconnects, or reconnects.

## 0.6.0

- Fixed minimizing the window (not just closing it) leaving a taskbar/panel entry behind. The
  window's own minimize action isn't cancelable the way close is, so it always minimized first;
  now it's immediately swapped for a real hide, so minimize-to-tray means gone from the panel
  entirely, not just iconified.
- The update-status dot is 50% bigger.
- Clicking the update dot now checks for updates immediately in every state, not just when an
  update is already available or ready to install.
- Added a Settings option for the tray icon style: colour (red/amber/green, matching the sidebar)
  or black and white (a plain dot at varying opacity to hint status instead of colour).

## 0.5.1

- Fixed the tray menu's "Hide Bitty"/"Show Bitty" label getting stuck out of sync with the
  window's actual visibility when it was hidden via the window's own close button rather than
  through the tray icon itself. It now stays accurate regardless of which path hid or showed
  the window.

## 0.5.0

- Fixed a serious bug: the app had no single-instance lock, so relaunching it while already
  running (easy to do by accident now that closing minimizes to tray instead of quitting) spawned
  a full duplicate instance, its own window, its own tray icon, and its own VPN helper fighting
  the first one over the same namespace and control sockets. That's what caused stuck,
  unresponsive tray icons. Launching it again now just brings the existing window forward.
- VPN now connects automatically on launch if a config is already saved, instead of waiting for a
  manual Connect click. The `pkexec` password prompt still appears, that's unavoidable, but it's
  the only step now.
- Active torrents are now remembered and resume automatically. Previously the list was only ever
  in memory, so it reset to empty every time the worker restarted (which happens on every VPN
  reconnect, and definitely on every app relaunch), even though the VPN itself reconnected fine.
- Added a genuine "delete torrent and files" action (the danger-armed confirm pattern, a second
  deliberate click) alongside the existing "remove from list" action, which now keeps downloaded
  files and no longer needs a confirm click since it isn't destructive.

## 0.4.2

- Icon buttons (torrent row pause/remove, settings close) are now circular and borderless
  instead of bordered rounded squares, matching Charlie's standard icon-button style.

## 0.4.1

- Fixed DNS resolution being completely broken inside the torrent engine's isolated namespace,
  which silently failed every tracker and DHT hostname lookup, so torrents could show real
  seed/peer counts elsewhere while finding zero here. The namespace was relying on whatever the
  host's `/etc/resolv.conf` pointed at, which is often a loopback-scoped resolver (systemd-resolved,
  Tailscale MagicDNS, etc.) unreachable from inside an isolated namespace. It now gets its own,
  independent DNS servers.
- Fixed adding a magnet link or `.torrent` file often timing out ("timeout waiting for
  add-magnet") even though the torrent was actually added, the magnet input stayed filled and a
  red error appeared even on success. The worker was waiting for full metadata (which can take a
  long time) before replying; it now replies as soon as the torrent is parsed.
- Fixed the VPN helper and torrent worker crashing outright on any abrupt client disconnect
  (`ECONNRESET`) due to a missing error handler on the control socket, found while testing the
  above.

## 0.4.0

- Added minimize to tray. Closing the window now hides it instead of quitting, so the VPN
  tunnel and any active torrents keep running in the background; a tray icon lets you show the
  window again or quit for real. Show/hide/quit verified directly against the running app.
- Known caveat: on Cinnamon, the tray icon may render as a generic system glyph instead of the
  intended red/amber/green dot. Root cause confirmed by comparing against another app's tray
  icon on the same system: Electron's built-in `Tray` class only ever sends one icon size over
  D-Bus, no matter how many are provided, while apps that render correctly there are using a
  different, non-Electron-builtin tray implementation. Not something fixable by changing the
  image; the show/hide/quit behaviour itself is unaffected.

## 0.3.3

- Fixed the torrent worker crashing every time an actual magnet link or torrent was added
  (`ERR_INVALID_ARG_TYPE` in `arr2hex`). `webtorrent` 2.x expected its `parse-torrent`
  dependency to hand back the info hash as a raw byte buffer, but the resolved version of
  `parse-torrent` had since changed to return it as a hex string instead, an upstream
  incompatibility, not something introduced here. Upgraded to `webtorrent` 3.x, which is built
  against the current `parse-torrent` API. Verified directly: adding a real public magnet link
  no longer crashes the worker.

## 0.3.2

- Fixed the torrent engine crashing on startup every time (`ERR_REQUIRE_ASYNC_MODULE`), which
  meant torrenting never actually worked even with the VPN connected, "connect the VPN first"
  showed even when it already was. `webtorrent` is a pure ESM package; loading it via `require()`
  broke under the Node version bundled with the current Electron. Switched to dynamic `import()`.

## 0.3.1

- Error messages (adding a magnet link before the VPN is connected, VPN config problems, etc.)
  now show as plain text instead of Electron's raw "Error invoking remote method..." wrapper.

## 0.3.0

- Redesigned the whole interface: a fixed sidebar (VPN status, VPN configuration, Settings)
  next to a full-width torrent list, instead of the previous three-way-split panel layout.
- The VPN status is now a large, unmissable card at the top of the sidebar: solid red when
  disconnected, amber while connecting/reconnecting, solid green when connected with the
  active IP shown.
- Secondary settings (download folder, speed limits) moved into a dedicated modal opened from
  a Settings button, decluttering the main view without hiding them, they're one click away.
- Toolbar (add magnet/torrent, open folder) now sits directly above the torrent list, which
  uses the full width of the window, an empty-state illustration replaces the plain text row.

## 0.2.2

- Fixed the Settings panel silently clipping its bottom fields, the manual speed cap was
  invisible unless you manually resized the window taller, with no indication it was there.
  Reworked the whole layout into three columns (VPN + Add torrent stacked, Settings, Torrents)
  instead of two, so every static panel gets enough room to show all of its content at the
  default window size with no scrollbar anywhere. The torrent list keeps its own internal
  scroll once it has more entries than fit, that's an unbounded list, not hidden settings.

## 0.2.1

- Fixed VPN connect always failing with "authorization declined or failed, exit code 126" when
  running from the packaged AppImage. Root can't read into the AppImage's private FUSE mount
  even via `pkexec`, so the privileged helper could never actually start. The app now extracts
  its own contents to a normal, root-readable cache directory before elevating, and launches the
  helper from there.
- Replaced the version pill and separate restart banner with the standard single-dot update
  widget: app name and version link out to the app's website, followed by one dot that shows
  up-to-date (green), update available (amber, click to download), downloading (progress ring),
  ready to restart (green, click to restart), or can't reach GitHub (red). Downloads no longer
  start automatically, only when the dot is clicked.

## 0.2.0

- Auto-update via GitHub Releases: a status dot next to the version number (green up to date,
  yellow update pending, red check failed), checks every 30 minutes plus on click, downloads
  automatically, and prompts to restart once ready.
- Repo made public so update checks need no embedded credentials.
- Redesigned the window as a two-column layout that fits on one screen at the default size, no
  page-level scrolling; the torrent list scrolls internally once it has more entries than fit.
- Fixed the privileged helper's control socket being unreachable by the main process (root-owned,
  mode 0600); it's now chowned to the invoking user.
- OpenVPN now runs with `--script-security 1` instead of `0`, fixing tunnel interface/route setup
  while still blocking arbitrary up/down scripts from a malicious `.ovpn` file.
- `.ovpn` files with an invalid port are now rejected at upload instead of producing a broken
  firewall rule.
- Auto-reconnect now gives up after 8 attempts instead of retrying forever.

## 0.1.0

Initial build.

- Electron + WebTorrent client packaged as a single Linux AppImage.
- VPN-only kill switch: torrent traffic runs inside an isolated network namespace with a
  default-deny firewall, allowing only the VPN tunnel and its own handshake endpoint. Namespace,
  firewall, and VPN process are created and torn down per session by a `pkexec`-elevated helper.
- Magnet link and `.torrent` file uploads.
- Configurable download folder.
- Global speed cap: manual number, or automatic percentage of measured connection speed.
- Settings and VPN credentials encrypted at rest via the OS keyring (Electron `safeStorage`).
