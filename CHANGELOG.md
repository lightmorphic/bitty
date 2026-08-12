# Changelog

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
