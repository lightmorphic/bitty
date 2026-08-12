# Security

## Threat model

Bitty runs a privileged helper (via `pkexec`) to build a network namespace and firewall rules
that a normal user cannot create. That helper is the trust boundary in this app. It is designed
to do exactly four things as root: manage the namespace/veth/firewall, launch OpenVPN inside it,
launch the (privilege-dropped) torrent worker inside it, and tear all of that down. It does not
run any code supplied by an uploaded `.ovpn` file beyond OpenVPN's own built-in networking calls
(`--script-security 1`), so a malicious config file cannot use it to run arbitrary commands as
root.

## Reporting an issue

This is a personal project, not a public product. If you find a security problem, open an issue
on the repo or contact the maintainer directly rather than filing it publicly if it's exploitable
in a way that affects other users of this code.

## Known accepted risk

`webtorrent`'s `bittorrent-tracker` dependency pulls in `ip`, which has an unpatched advisory
(GHSA-2p57-rm9w-gvfp) about misclassifying some addresses as public. There is no non-breaking fix
available upstream. Impact here is limited by the app's own architecture: the torrent engine only
ever runs inside the isolated network namespace, which has no route to the LAN or any host-local
address regardless of what that library decides an address is.
