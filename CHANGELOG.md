# Changelog

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
