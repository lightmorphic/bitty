// Pulls out just what the killswitch needs to know from an .ovpn file:
// the server(s) it dials and the transport. We don't need to understand
// the rest of the config; OpenVPN itself does.

function parseOvpn(text) {
  const remotes = [];
  let proto = 'udp';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'remote' && parts[1]) {
      remotes.push({ host: parts[1], port: parts[2] ? Number(parts[2]) : 1194 });
    } else if (parts[0] === 'proto') {
      proto = parts[1].replace(/-.*/, ''); // udp6 -> udp, tcp-client -> tcp
    }
  }
  if (!remotes.length) throw new Error('.ovpn file has no "remote" directive — cannot determine VPN server');
  return { remotes, proto };
}

module.exports = { parseOvpn };
