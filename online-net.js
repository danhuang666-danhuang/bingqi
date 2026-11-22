/* =============================================================
 * online-net.js —— 线上对战的房间通信层（不依赖 DOM）
 *
 * 设计目标：网页仍然是静态文件，不要求另外租服务器。
 * 房间消息走公共 MQTT 中继（EMQX / HiveMQ / Mosquitto 均可），
 * 房间号 + 房间状态 / 地图都用房间码派生的 AES-GCM 密钥加密，
 * 中继只看到哈希后的主题名和密文。
 *
 * 房间主题（<room> = 房间码的 SHA-256 前缀）：
 *   bingqi/v2/<room>/host        房主状态（retained）
 *   bingqi/v2/<room>/map         当前地图（retained）
 *   bingqi/v2/<room>/p/<id>      每个玩家的状态（retained）
 *
 * 这个文件在浏览器和 Node 下都能用，方便单独跑协议测试。
 * 不依赖 DOM，也不直接读 localStorage。
 * ============================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OnlineNet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROTO = 2;
  const PREFIX = 'bingqi/v2/';
  const MAX_PLAYERS = 4;      // 2v2：攻方 2 + 守方 2，房主算其中一人
  const MAX_PER_SIDE = 2;
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'; // 去掉 I / O，避免和 1 / 0 混淆
  const CODE_LEN = 8;
  const KDF_ITERATIONS = 120000;
  const KDF_SALT = 'bingqi-online-v2';
  const HEARTBEAT_MS = 25000;
  const CONNECT_TIMEOUT_MS = 12000;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /* ---------------- 房间码 ---------------- */

  function normalizeCode(raw) {
    let s = String(raw == null ? '' : raw).toUpperCase();
    s = s.replace(/[^A-Z0-9]/g, '');
    s = s.replace(/O/g, '0').replace(/I/g, '1');
    return s;
  }

  function isValidCode(code) {
    if (code.length !== CODE_LEN) return false;
    for (let i = 0; i < code.length; i++) {
      if (CODE_ALPHABET.indexOf(code[i]) < 0) return false;
    }
    return true;
  }

  function formatCode(code) {
    const s = normalizeCode(code);
    return s.length === CODE_LEN ? s.slice(0, 4) + '-' + s.slice(4) : s;
  }

  function randomCode() {
    const bytes = new Uint8Array(CODE_LEN * 2);
    const cryptoObj = globalCrypto();
    cryptoObj.getRandomValues(bytes);
    let out = '';
    let i = 0;
    while (out.length < CODE_LEN) {
      // 拒绝采样，避免 256 % 34 的偏差
      const v = bytes[i++ % bytes.length];
      if (v >= 238) continue; // 34 * 7
      out += CODE_ALPHABET[v % CODE_ALPHABET.length];
    }
    return out;
  }

  function hashRoom(code) {
    const data = encoder.encode('bingqi-room-v2:' + normalizeCode(code));
    return globalCrypto().subtle.digest('SHA-256', data).then(function (buf) {
      return bytesToHex(new Uint8Array(buf)).slice(0, 24);
    });
  }

  function deriveKey(code) {
    const cryptoObj = globalCrypto();
    const material = encoder.encode(normalizeCode(code) + ':bingqi-room-key-v2');
    return cryptoObj.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return cryptoObj.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: encoder.encode(KDF_SALT),
            iterations: KDF_ITERATIONS,
            hash: 'SHA-256',
          },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /* ---------------- 字节 / 文本 ---------------- */

  function globalCrypto() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto;
    throw new Error('当前环境不支持 Web Crypto（需要 HTTPS / localhost / file://）');
  }

  function bytesToHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
    return s;
  }

  function bytesToB64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function b64ToBytes(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function encryptJSON(key, value, aad) {
    const iv = new Uint8Array(12);
    globalCrypto().getRandomValues(iv);
    const plain = encoder.encode(JSON.stringify(value));
    const params = { name: 'AES-GCM', iv: iv };
    if (aad) params.additionalData = encoder.encode(aad);
    return globalCrypto().subtle.encrypt(params, key, plain).then(function (buf) {
      return JSON.stringify({ v: PROTO, n: bytesToB64(iv), d: bytesToB64(new Uint8Array(buf)) });
    });
  }

  function decryptJSON(key, text, aad) {
    let env;
    try { env = JSON.parse(text); } catch (e) { return Promise.resolve(null); }
    if (!env || env.v !== PROTO || !env.n || !env.d) return Promise.resolve(null);
    const params = { name: 'AES-GCM', iv: b64ToBytes(env.n) };
    if (aad) params.additionalData = encoder.encode(aad);
    return globalCrypto().subtle.decrypt(params, key, b64ToBytes(env.d))
      .then(function (buf) { return JSON.parse(decoder.decode(new Uint8Array(buf))); })
      .catch(function () { return null; });
  }

  /* ---------------- 通信 ---------------- */

  function makeClientId(role, selfId) {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'bq' + (role === 'host' ? 'h' : 'g') + selfId.slice(0, 8) + rand;
  }

  /**
   * 创建一个房间连接。返回 Promise<net>。
   *
   * opts:
   *   brokerUrl  MQTT WebSocket 地址
   *   roomCode   8 位房间码
   *   role       'host' | 'guest'
   *   name       昵称
   *   selfId     本端 id（建议 8~16 位十六进制）
   *   mqttLib    可选，Node 下传入 require('mqtt')；浏览器默认用 window.mqtt
   *   onStatus   ({state, message})
   *   onHost     (presence)
   *   onGuest    (presence)
   *   onGuestRemoved (id)
   *   onMap      ({title, map, from})
   *   onLog      (msg)  仅调试用
   */
  function createNet(opts) {
    const o = opts || {};
    const role = o.role === 'host' ? 'host' : 'guest';
    const code = normalizeCode(o.roomCode);
    if (!isValidCode(code)) return Promise.reject(new Error('房间码格式不对（需要 8 位字母数字）'));
    if (!o.brokerUrl) return Promise.reject(new Error('缺少中继服务器地址'));
    if (!o.selfId) return Promise.reject(new Error('缺少本端 id'));

    const mqttLib = o.mqttLib || (typeof window !== 'undefined' ? window.mqtt : null);
    if (!mqttLib || typeof mqttLib.connect !== 'function') {
      return Promise.reject(new Error('MQTT 组件没有加载'));
    }

    const selfId = String(o.selfId);
    const name = String(o.name || '指挥官').slice(0, 16);
    const status = typeof o.onStatus === 'function' ? o.onStatus : function () {};
    const onHost = typeof o.onHost === 'function' ? o.onHost : function () {};
    const onGuest = typeof o.onGuest === 'function' ? o.onGuest : function () {};
    const onGuestRemoved = typeof o.onGuestRemoved === 'function' ? o.onGuestRemoved : function () {};
    const onMap = typeof o.onMap === 'function' ? o.onMap : function () {};
    const onLog = typeof o.onLog === 'function' ? o.onLog : function () {};

    let client = null;
    let key = null;
    let roomHash = '';
    let root = '';
    let hostTopic = '';
    let mapTopic = '';
    let presenceTopic = '';
    let aad = '';
    let connected = false;
    let closed = false;
    let heartbeatTimer = 0;
    let connectResolve = null;
    let connectReject = null;
    let connectTimer = 0;
    let ended = false;

    let hostState = null;   // 本端是房主时的状态
    let guestState = null;  // 本端是玩家时的状态
    let lastMap = null;

    function setStatus(state, message) {
      status({ state: state, message: message || '' });
    }

    function baseState(online) {
      const now = Date.now();
      if (role === 'host') {
        return {
          v: PROTO, role: 'host', id: selfId, name: name, online: online,
          phase: 'lobby', mode: null, side: null, faction: null,
          factionReady: false, deckReady: false, prep: null,
          decks: null, deploy: null,
          map: null, teams: null, factions: null,
          maxPlayers: MAX_PLAYERS, ts: now, joinedAt: now,
        };
      }
      return {
        v: PROTO, role: 'guest', id: selfId, name: name, online: online,
        side: null, faction: null, factionReady: false, deckReady: false, prep: null,
        deploy: null,
        ready: false, ts: now, joinedAt: now,
      };
    }

    function mergeState(prev, partial, online) {
      const next = Object.assign({}, prev || baseState(online), partial || {});
      next.v = PROTO;
      next.role = role;
      next.id = selfId;
      next.name = name;
      next.online = online;
      next.ts = Date.now();
      return next;
    }

    function publishRaw(topic, payload, retain) {
      if (!client || !connected) return Promise.resolve(false);
      return new Promise(function (resolve) {
        client.publish(topic, payload, { qos: 1, retain: !!retain }, function (err) {
          if (err) onLog('publish failed: ' + topic + ' ' + err.message);
          resolve(!err);
        });
      });
    }

    function publishPresence() {
      if (!connected) return Promise.resolve(false);
      const st = role === 'host' ? hostState : guestState;
      if (!st) return Promise.resolve(false);
      return encryptJSON(key, st, aad).then(function (payload) {
        return publishRaw(presenceTopic, payload, true);
      });
    }

    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(function () {
        publishPresence();
      }, HEARTBEAT_MS);
      if (heartbeatTimer.unref) heartbeatTimer.unref();
    }

    function stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = 0;
    }

    function onMessage(topic, payload) {
      if (!topic || topic.indexOf(root + '/') !== 0) return;

      // 清空 retained（玩家主动离开）时没有密文
      if (!payload || !payload.length) {
        if (topic.indexOf(root + '/p/') === 0) {
          const id = topic.slice((root + '/p/').length);
          if (id && id !== selfId) onGuestRemoved(id);
        }
        return;
      }

      let text;
      try {
        text = typeof payload === 'string' ? payload : decoder.decode(payload);
      } catch (e) { return; }

      decryptJSON(key, text, aad).then(function (msg) {
        if (!msg) return;
        if (topic === hostTopic) {
          if (role === 'host') return;           // 自己的回声
          if (msg.role !== 'host') return;
          onHost(msg);
          return;
        }
        if (topic === mapTopic) {
          if (role === 'host') return;
          if (!msg || !msg.map) return;
          onMap(msg);
          return;
        }
        if (topic.indexOf(root + '/p/') === 0) {
          const id = topic.slice((root + '/p/').length);
          if (!id || id === selfId) return;
          if (msg.role !== 'guest') return;
          onGuest(msg);
        }
      });
    }

    function subscribe() {
      if (!client || !connected) return;
      client.subscribe(root + '/#', { qos: 1 }, function (err) {
        if (err) {
          onLog('subscribe failed: ' + err.message);
          setStatus('error', '订阅房间失败：' + err.message);
          return;
        }
        // 订阅完成后再发布本端状态，避免自己收不到 retained
        if (role === 'host') {
          if (!hostState) hostState = baseState(true);
          publishPresence();
          if (lastMap) {
            encryptJSON(key, lastMap, aad).then(function (payload) {
              publishRaw(mapTopic, payload, true);
            });
          } else {
            // 新房主刚连上：清掉同房间码可能残留的旧地图（例如上一次房主崩溃）
            publishRaw(mapTopic, '', true);
          }
        } else {
          if (!guestState) guestState = baseState(true);
          publishPresence();
        }
      });
    }

    function bindClient() {
      client.on('connect', function () {
        connected = true;
        setStatus('connected');
        subscribe();
        startHeartbeat();
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = 0;
        if (connectResolve) { connectResolve(controller); connectResolve = null; connectReject = null; }
      });

      client.on('reconnect', function () {
        connected = false;
        setStatus('reconnecting');
      });

      client.on('close', function () {
        connected = false;
        if (!closed) setStatus('closed');
      });

      client.on('offline', function () {
        connected = false;
        if (!closed) setStatus('offline');
      });

      client.on('error', function (err) {
        if (closed) return;
        setStatus('error', err && err.message ? err.message : '中继连接出错');
        if (connectReject) {
          if (connectTimer) clearTimeout(connectTimer);
          connectTimer = 0;
          const reject = connectReject;
          connectResolve = null;
          connectReject = null;
          reject(new Error(err && err.message ? err.message : '中继连接出错'));
        }
      });

      client.on('message', onMessage);
    }

    function connect() {
      setStatus('connecting');
      return deriveKey(code)
        .then(function (derived) {
          key = derived;
          return hashRoom(code);
        })
        .then(function (hash) {
          roomHash = hash;
          root = PREFIX + roomHash;
          hostTopic = root + '/host';
          mapTopic = root + '/map';
          presenceTopic = role === 'host' ? hostTopic : (root + '/p/' + selfId);
          aad = PREFIX + roomHash;

          const offline = mergeState(role === 'host' ? hostState : guestState, {}, false);
          return encryptJSON(key, offline, aad);
        })
        .then(function (willPayload) {
          return new Promise(function (resolve, reject) {
            connectResolve = resolve;
            connectReject = reject;
            const url = String(o.brokerUrl);
            client = mqttLib.connect(url, {
              clientId: makeClientId(role, selfId),
              clean: true,
              protocolVersion: 4,
              keepalive: 30,
              reconnectPeriod: 2500,
              connectTimeout: 9000,
              will: {
                topic: presenceTopic,
                payload: willPayload,
                qos: 1,
                retain: true,
              },
            });
            bindClient();
            connectTimer = setTimeout(function () {
              if (connected) return;
              connectTimer = 0;
              connectResolve = null;
              connectReject = null;
              try { client.end(true); } catch (e) { /* ignore */ }
              reject(new Error('连接中继超时，请检查网络或换一个中继'));
            }, CONNECT_TIMEOUT_MS);
            if (connectTimer.unref) connectTimer.unref();
          });
        })
        .then(function () {
          return controller;
        });
    }

    function setHostState(partial) {
      hostState = mergeState(hostState, partial, true);
      return publishPresence();
    }

    function setGuestState(partial) {
      guestState = mergeState(guestState, partial, true);
      return publishPresence();
    }

    function publishMap(wrapper) {
      const w = Object.assign({ v: PROTO, from: selfId, ts: Date.now() }, wrapper || {});
      lastMap = w;
      if (!connected) return Promise.resolve(false);
      return encryptJSON(key, w, aad).then(function (payload) {
        return publishRaw(mapTopic, payload, true);
      });
    }

    function clearMap() {
      lastMap = null;
      if (!connected) return Promise.resolve(false);
      return publishRaw(mapTopic, '', true);
    }

    function disconnect() {
      if (closed) return Promise.resolve();
      closed = true;
      stopHeartbeat();
      if (!client) return Promise.resolve();

      const finish = function () {
        if (ended) return Promise.resolve();
        ended = true;
        try { client.end(false); } catch (e) { /* ignore */ }
        connected = false;
        setStatus('closed');
        return Promise.resolve();
      };

      if (!connected) return finish();

      let payloadPromise;
      if (role === 'host') {
        const offline = mergeState(hostState, { online: false, closed: true }, false);
        payloadPromise = encryptJSON(key, offline, aad);
      } else {
        payloadPromise = Promise.resolve('');
      }

      return payloadPromise.then(function (payload) {
        const topic = presenceTopic;
        const done = function () { finish(); };
        client.publish(topic, payload, { qos: 1, retain: true }, function () {
          setTimeout(done, 120);
        });
        setTimeout(done, 800); // 中继不回 PUBACK 时也别卡住
        if (role === 'host' && lastMap) {
          // 房主离开后清掉 retained 地图，避免旧图被下一位同码房主读到
          client.publish(mapTopic, '', { qos: 1, retain: true });
        }
      }).then(function () { return undefined; });
    }

    const controller = {
      role: role,
      code: code,
      formattedCode: formatCode(code),
      roomHash: function () { return roomHash; },
      topics: function () {
        return { root: root, host: hostTopic, map: mapTopic, presence: presenceTopic };
      },
      connect: connect,
      setHostState: setHostState,
      setGuestState: setGuestState,
      publishMap: publishMap,
      clearMap: clearMap,
      publishPresence: publishPresence,
      disconnect: disconnect,
      isConnected: function () { return connected; },
      _onMessage: onMessage,
    };

    return Promise.resolve(controller);
  }

  return {
    PROTO: PROTO,
    PREFIX: PREFIX,
    MAX_PLAYERS: MAX_PLAYERS,
    MAX_PER_SIDE: MAX_PER_SIDE,
    CODE_ALPHABET: CODE_ALPHABET,
    CODE_LEN: CODE_LEN,
    normalizeCode: normalizeCode,
    isValidCode: isValidCode,
    formatCode: formatCode,
    randomCode: randomCode,
    hashRoom: hashRoom,
    deriveKey: deriveKey,
    encryptJSON: encryptJSON,
    decryptJSON: decryptJSON,
    createNet: createNet,
  };
});
