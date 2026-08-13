# Bitty

A VPN-only BitTorrent client, packaged as a single self-contained Linux AppImage.

## What it does

- Add torrents by magnet link or `.torrent` file.
- Upload an OpenVPN `.ovpn` config (from PIA or any other provider) and it connects through that.
- **Torrenting is physically impossible without the VPN.** The torrent engine runs inside an
  isolated network namespace that this app creates and destroys itself. That namespace has a
  firewall rule set (a "kill switch") that only allows two things out: the VPN tunnel itself, and
  the one specific VPN server address needed to establish that tunnel. There is no default route
  and no firewall rule that lets anything else leave, not even to your own LAN. If the VPN drops,
  the torrent engine is stopped immediately, and the firewall would block it even if it weren't.
- Everything is torn down when you actually quit: namespace, firewall rules, VPN process. Nothing
  is left running or configured on your machine afterwards.
- A single speed cap for the whole app (not per-torrent), either a manual number you set, or an
  automatic mode that limits itself to a percentage (default 50%, configurable) of your measured
  connection speed.
- Auto-update: the dot next to the version number in the sidebar is green when you're up to date,
  amber when an update is available (click it to download), a progress ring while downloading,
  and green with a restart icon once it's ready (click to restart). Red means it couldn't reach
  GitHub. Checks automatically every 30 minutes.
- Minimize to tray: closing the window hides it instead of quitting, the VPN tunnel and any
  active torrents keep running in the background. Use the tray icon to bring the window back or
  quit for real. The tray icon's colour follows VPN status the same way the sidebar does, though
  on some Linux desktops (Cinnamon in particular) it may show as a generic icon instead of a
  coloured dot, a limitation of that desktop's tray host, not something this app controls.

**The one exception to VPN-only networking:** checking GitHub for a new version is a direct call
made by the main app window, not through the VPN or the isolated namespace, the same as any
desktop app's update checker. It never touches your torrent traffic or the namespace. The torrent
engine itself remains fully VPN-only as described above.

## Why it needs a password prompt (`pkexec`)

Creating that isolated network and firewall setup needs root. There's no way to do a real kill
switch as a normal user, Linux just doesn't allow it. The app itself still runs as you; only the
small networking helper process runs elevated, and only for as long as the app is open.

## Installing / running

```bash
chmod +x Bitty-0.2.0.AppImage
./Bitty-0.2.0.AppImage
```

No install step, no system-wide changes. Needs these already on your system (all standard on any
Debian/Ubuntu-family desktop): `openvpn`, `iproute2` (`ip`), `nftables` (`nft`), `iptables`,
`polkit` (`pkexec`), `util-linux` (`setpriv`).

## First run

1. Open the app. Upload your provider's `.ovpn` file under "VPN connection".
2. If your provider needs a username/password (most do), enter them. They're saved encrypted
   using your OS's own keyring (via Electron's `safeStorage`), not as plain text.
3. Click "Connect". You'll get a password prompt from your desktop. That's for the one-time setup
   of the network namespace and firewall, described above.
4. Once the badge at the top says "VPN connected", add a torrent.

## Settings

- **Download folder.** Where finished/in-progress files land.
- **Automatic speed limit.** On by default, limits the app to a percentage of what it's actually
  able to achieve when unthrottled. No external speed-test call is made; it's based on the app's
  own real transfer speed.
- **Manual speed cap.** Used instead, when the automatic option is switched off.

## If something goes wrong

- **"VPN helper could not start."** You cancelled the password prompt, or `pkexec`/polkit isn't
  set up on your system. Try again; if it keeps failing, check `polkit` is installed and a polkit
  authentication agent is running (normal on any standard desktop).
- **Stuck on "connecting."** Check your `.ovpn` file's `remote` line is reachable, and that your
  username/password are correct. Re-upload the file if you're not sure it saved correctly.
- **Nothing downloads even though it says connected.** The torrent may just have no seeders.
  Check the peer count column.
- **Closing the window** minimizes to tray, it does not quit or disconnect the VPN. Use "Quit
  Bitty" from the tray icon's menu to actually exit, which always disconnects the VPN and removes
  the namespace/firewall rules first. If it's ever force-killed (crash, `kill -9`) instead of quit
  normally, run this once to clean up manually:
  ```bash
  sudo ip netns del bitty0 2>/dev/null
  sudo ip link del bitty-veth0 2>/dev/null
  ```
  This is inert if there's nothing to clean up.

## Rebuilding from source

```bash
npm install
npm run build     # produces dist/Bitty-<version>.AppImage, local only, no publish
```

## Cutting a release

Every GitHub release carries two copies of the AppImage: `Bitty-<version>.AppImage` (pinned,
also what the in-app updater tracks) and `Bitty.AppImage` (unversioned, always the newest
release, for a stable download link). To cut one:

```bash
npm version <patch|minor|major>   # bumps package.json, add a matching CHANGELOG.md entry
git push && git push --tags
npm run release                    # builds, publishes, and uploads both AppImage copies
```

## License

GPLv3. See [LICENSE](LICENSE).

## Known limitation

WebTorrent's tracker-handling dependency (`ip`) has an unpatched advisory
(GHSA-2p57-rm9w-gvfp) around misclassifying some IP addresses as public. In this app that risk is
substantially contained: the torrent engine only ever runs inside the isolated network namespace,
which has no route to your LAN or any host-local address regardless. There's nowhere for a
misclassified address to actually reach even if triggered.
