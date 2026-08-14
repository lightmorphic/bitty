// Custom StatusNotifierItem + DBusMenu implementation, replacing
// Electron's built-in Tray class entirely for the icon/menu/click side
// (window show/hide itself is still plain Electron BrowserWindow calls).
//
// Why: direct D-Bus property comparison against a tray icon that renders
// and responds to clicks correctly on this same system showed Electron's
// Tray never exports an IconName property at all (not empty, genuinely
// absent as a key), where a spec-compliant item always has it, even as an
// empty string when it isn't used. Cinnamon's xapp-sn-watcher appears to
// treat an item missing that property as a broken placeholder: generic
// icon, and clicks don't reach it. Confirmed empirically (see below) that
// hand-building the StatusNotifierItem and DBusMenu interfaces directly
// produces wire output matching a known-working reference item exactly.
//
// Icon delivery is IconName + IconThemePath (a bundled, private icon
// theme directory) rather than raw IconPixmap, since a theme-referenced
// icon is how the tray icons that do render correctly on this system
// appear to work, and it lets the desktop's own icon loader pick the
// right size instead of us guessing one. IconPixmap is still declared
// (empty) so the property is present either way.

const dbus = require('@homebridge/dbus-native');
const { EventEmitter } = require('events');

const SNI_IFACE = {
  name: 'org.kde.StatusNotifierItem',
  methods: {
    Activate: ['ii', ''],
    SecondaryActivate: ['ii', ''],
    ContextMenu: ['ii', ''],
    Scroll: ['is', ''],
  },
  properties: {
    Category: 's',
    Id: 's',
    Title: 's',
    Status: 's',
    IconName: 's',
    IconThemePath: 's',
    IconPixmap: 'a(iiay)',
    OverlayIconName: 's',
    OverlayIconPixmap: 'a(iiay)',
    AttentionIconName: 's',
    AttentionIconPixmap: 'a(iiay)',
    AttentionMovieName: 's',
    ToolTip: '(sa(iiay)ss)',
    ItemIsMenu: 'b',
    Menu: 'o',
    WindowId: 'i',
  },
  signals: {
    NewTitle: [],
    NewIcon: [],
    NewAttentionIcon: [],
    NewOverlayIcon: [],
    NewToolTip: [],
    NewStatus: ['s'],
  },
};

const MENU_IFACE = {
  name: 'com.canonical.dbusmenu',
  methods: {
    GetLayout: ['iias', 'u(ia{sv}av)'],
    GetGroupProperties: ['aias', 'a(ia{sv})'],
    Event: ['isvu', ''],
    EventGroup: ['a(isvu)', 'ai'],
    AboutToShow: ['i', 'b'],
    AboutToShowGroup: ['ai', 'aiai'],
  },
  properties: {
    Version: 'u',
    TextDirection: 's',
    Status: 's',
  },
  signals: {
    LayoutUpdated: ['ui'],
    ItemsPropertiesUpdated: ['a(ia{sv})', 'a(ias)'],
  },
};

const MENU_ID_TOGGLE = 1;
const MENU_ID_QUIT = 2;

class SniTray {
  constructor({ getWindow, quitApp }) {
    this.getWindow = getWindow;
    this.quitApp = quitApp;
    this.bus = null;
    this.style = 'color';
    this.themePath = null;
    this.lastStatus = { status: 'disconnected', ip: null };
    this.menuRevision = 1;
  }

  init({ themePath }) {
    this.themePath = themePath;
    this.bus = dbus.sessionBus();
    // Belt-and-braces: a write to the underlying socket after it's been
    // ended (e.g. a reply racing our own teardown on quit) throws as an
    // uncaught exception with no handler attached here, which would take
    // the entire Electron main process down over what's really just a
    // tray icon. Deferring the quit above should prevent that particular
    // case, but there's no reason a stray write error should ever be fatal
    // to the whole app either way.
    if (this.bus.connection) {
      this.bus.connection.on('error', (err) => {
        process.stderr.write('[bitty-tray] connection error: ' + err + '\n');
      });
    }

    this.sni = Object.assign(new EventEmitter(), {
      Category: 'ApplicationStatus',
      Id: `Bitty_${process.pid}`,
      Title: 'Bitty',
      Status: 'Active',
      IconName: 'bitty-tray-disconnected',
      IconThemePath: this.themePath,
      IconPixmap: [],
      OverlayIconName: '',
      OverlayIconPixmap: [],
      AttentionIconName: '',
      AttentionIconPixmap: [],
      AttentionMovieName: '',
      ToolTip: ['', [], 'Bitty', 'VPN not connected'],
      ItemIsMenu: false,
      Menu: '/MenuBar',
      WindowId: 0,
      Activate: () => { this.toggleWindow(); return null; },
      SecondaryActivate: () => { this.toggleWindow(); return null; },
      ContextMenu: () => { this.toggleWindow(); return null; },
      Scroll: () => null,
    });

    this.menu = Object.assign(new EventEmitter(), {
      Version: 3,
      TextDirection: 'ltr',
      Status: 'normal',
      GetLayout: (parentId, depth, propertyNames) => this._menuLayout(),
      GetGroupProperties: (ids) => this._menuGroupProperties(ids),
      Event: (id, eventId) => { this._handleEvent(id, eventId); return null; },
      // Cinnamon's dbusmenu client (and others) send clicks through this
      // batched form instead of the singular Event/AboutToShow above, never
      // falling back, so a server that only implements the singular pair
      // looks completely dead to it: the menu still renders (that's
      // GetLayout/GetGroupProperties, a separate pair), but every click
      // hits an undeclared method and is silently dropped.
      EventGroup: (events) => {
        (events || []).forEach(([id, eventId]) => this._handleEvent(id, eventId));
        return [];
      },
      AboutToShow: () => false,
      AboutToShowGroup: () => [[], []],
    });

    this.bus.exportInterface(this.sni, '/StatusNotifierItem', SNI_IFACE);
    this.bus.exportInterface(this.menu, '/MenuBar', MENU_IFACE);

    const busName = `org.freedesktop.StatusNotifierItem-${process.pid}-1`;
    this.bus.requestName(busName, 0, (err) => {
      if (err) { process.stderr.write('[bitty-tray] requestName failed: ' + err + '\n'); return; }
      this.bus.invoke(
        {
          path: '/StatusNotifierWatcher',
          destination: 'org.kde.StatusNotifierWatcher',
          interface: 'org.kde.StatusNotifierWatcher',
          member: 'RegisterStatusNotifierItem',
          signature: 's',
          body: [busName],
        },
        (regErr) => {
          if (regErr) process.stderr.write('[bitty-tray] RegisterStatusNotifierItem failed: ' + regErr + '\n');
        },
      );
    });
  }

  // Item properties live here, shared between GetLayout (which embeds them
  // inline for clients that read the tree in one shot) and GetGroupProperties
  // (which some dbusmenu clients call separately to populate/refresh items
  // after reading the tree's shape from GetLayout). Returning [] from
  // GetGroupProperties unconditionally, as an earlier version of this file
  // did, is exactly what produced a correctly-sized but completely blank
  // menu: the client got the right item count and geometry from GetLayout
  // but then asked GetGroupProperties for the actual label text and got
  // nothing back.
  _menuItems() {
    const visible = !!this.getWindow() && this.getWindow().isVisible();
    return [
      {
        id: MENU_ID_TOGGLE,
        props: [
          ['label', ['s', visible ? 'Hide Bitty' : 'Show Bitty']],
          ['enabled', ['b', true]],
          ['visible', ['b', true]],
        ],
      },
      {
        id: 99,
        props: [
          ['type', ['s', 'separator']],
          ['enabled', ['b', true]],
          ['visible', ['b', true]],
        ],
      },
      {
        id: MENU_ID_QUIT,
        props: [
          ['label', ['s', 'Quit Bitty']],
          ['enabled', ['b', true]],
          ['visible', ['b', true]],
        ],
      },
    ];
  }

  _menuLayout() {
    const items = this._menuItems();
    const root = [
      0,
      [['children-display', ['s', 'submenu']]],
      items.map((item) => ['(ia{sv}av)', [item.id, item.props, []]]),
    ];
    return [this.menuRevision, root];
  }

  _handleEvent(id, eventId) {
    if (eventId !== 'clicked') return;
    if (id === MENU_ID_TOGGLE) this.toggleWindow();
    else if (id === MENU_ID_QUIT) {
      // quitApp() ends up tearing down this bus connection (see destroy()).
      // Doing that synchronously, inside the handler dbus-native invokes
      // this from, tears it down before the library has written back the
      // method-return reply for the very click that got us here, so it
      // tries to write to an already-ended stream and throws. Deferring by
      // a tick lets that reply flush first.
      setImmediate(() => this.quitApp());
    }
  }

  _menuGroupProperties(ids) {
    const items = this._menuItems();
    const byId = new Map(items.map((i) => [i.id, i.props]));
    const wantedIds = Array.isArray(ids) && ids.length ? ids : items.map((i) => i.id);
    return wantedIds.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)]);
  }

  refreshMenu() {
    if (!this.menu) return;
    this.menuRevision += 1;
    this.menu.emit('LayoutUpdated', this.menuRevision, 0);
  }

  toggleWindow() {
    const win = this.getWindow();
    if (!win) return;
    if (win.isVisible()) win.hide();
    else { win.show(); win.focus(); }
  }

  setIconStyle(style) {
    this.style = style === 'mono' ? 'mono' : 'color';
    this._applyIcon();
  }

  setVpnStatus(status) {
    this.lastStatus = status;
    this._applyIcon();
  }

  _applyIcon() {
    if (!this.sni) return;
    const status = this.lastStatus;
    let state;
    let label;
    if (status.status === 'connected') {
      state = 'connected';
      label = status.ip ? `VPN connected · ${status.ip}` : 'VPN connected';
    } else if (status.status === 'connecting' || status.status === 'reconnecting') {
      state = 'connecting';
      label = status.status === 'reconnecting' ? 'VPN reconnecting…' : 'VPN connecting…';
    } else {
      state = 'disconnected';
      label = 'VPN not connected';
    }
    this.sni.IconName = this.style === 'mono' ? `bitty-tray-mono-${state}` : `bitty-tray-${state}`;
    this.sni.ToolTip = ['', [], 'Bitty', label];
    if (typeof this.sni.emit === 'function') {
      this.sni.emit('NewIcon');
      this.sni.emit('NewToolTip');
      this.sni.emit('NewStatus', 'Active');
    }
  }

  destroy() {
    // No explicit unexport API on this library; releasing the bus
    // connection drops the well-known name and the watcher notices the
    // owner disappearing, which is enough to deregister cleanly.
    if (this.bus && this.bus.connection) {
      try { this.bus.connection.end(); } catch (_) {}
    }
    this.bus = null;
  }
}

module.exports = { SniTray };
