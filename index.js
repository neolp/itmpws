/* eslint-disable */
/* vscode-disable */

var CBOR = require('./cbor')
var COMMAND = {
  CONNECT: 0,
  CONNECTED: 1,
  ERROR: 5,
  CALL: 8,
  RESULT: 9,
  EVENT: 13,
  SUBSCRIBE: 16,
  UNSUBSCRIBE: 18
};

function ITMP(settings) {
  var defaultSettings = {
    uri: "ws://" + window.location.host + "/ws/",
    binaryType: null,
    autoReconnect: false,
    reconnectTimeout: 3000,
    reconnectMaxCount: 5,
    onOpen: function () { },
    onClose: function () { },
    onError: function () { },
    onReconnect: function () { }
  };

  this.settings = Object.assign({}, defaultSettings, settings);
  this.reset();
}

ITMP.prototype.reset = function () {
  this.state = WebSocket.CLOSED;
  this.reqIdCount = 0;
  this.reconnectCount = 0;
  this._messageQueue = [];
  this._calls = {};
  this._subs = {};
};

ITMP.prototype.connect = function () {
  this._ws = new WebSocket(this.settings.uri);
  if (this.settings.binaryType) {
    this._ws.binaryType = this.settings.binaryType;
  }
  // TODO
  this.state = this._ws.readyState;
  this._ws.onopen = this._onOpen.bind(this);
  this._ws.onclose = this._onClose.bind(this);
  this._ws.onmessage = this._onMessage.bind(this);
  this._ws.onerror = this._onError.bind(this);
};

ITMP.prototype.call = function (s) {
  var topic = s.topic,
    payload = s.payload,
    onSuccess = s.onSuccess,
    onError = s.onError;

  var reqId = this._getReqId();
  this._calls[reqId] = { onSuccess: onSuccess, onError: onError };
  this._send([COMMAND.CALL, reqId, topic, payload]);
};

ITMP.prototype.subscribe = function (topic, onEvent) {
  return new Promise((resolve, reject) => {

    if (this._subs[topic] === undefined) {
      var reqId = this._getReqId();
      this._subs[topic] = new Map()
      this._subs[topic].set(onEvent, { onEvent, count: 1 })
      this._calls[reqId] = { onSuccess: resolve, onError: reject };
      this._send([COMMAND.SUBSCRIBE, reqId, topic]);
      return
    }

    // Подписка уже есть, просто отправим call
    // this.call(s);
    if (this._subs[topic].has(onEvent)) {
      this._subs[topic].get(onEvent).count += 1;
    } else {
      this._subs[topic].set(onEvent, { onEvent, count: 1 });
    }
  })
};

ITMP.prototype._resubscribe = function () {
  for (var topic in this._subs) {
    var reqId = this._getReqId();
    this._calls[reqId] = { onSuccess: () => { }, onError: () => { } };
    this._send([COMMAND.SUBSCRIBE, reqId, topic]);
  }
};

ITMP.prototype.unsubscribe = function (topic, onEvent) {
  return new Promise((resolve, reject) => {
    if (this._subs[topic] && this._subs[topic].has(onEvent)) {
      this._subs[topic].get(onEvent).count -= 1;

      if (this._subs[topic].get(onEvent).count === 0) {
        this._subs[topic].delete(onEvent);

        if (this._subs[topic].size === 0) {
          delete this._subs[topic];

          var reqId = this._getReqId();
          this._calls[reqId] = { onSuccess: resolve, onError: reject };
          this._send([COMMAND.UNSUBSCRIBE, reqId, topic]);
        }
      }
    }
  })
};

ITMP.prototype._onOpen = function (evt) {
  console.log("ws open");
  this.state = this._ws.readyState;
  this._send(); // отправиль все сообщения из очереди

  if (this.reconnectCount) {
    this._resubscribe();
    this.reconnectCount = 0;
  }

  this.settings.onOpen(evt);
};

ITMP.prototype._onClose = function (evt) {
  this.settings.onClose(evt);
  this.state = this._ws.readyState;
  this._ws = null;
  if (this.settings.autoReconnect && this.reconnectCount < this.settings.reconnectMaxCount) {
    //TODO if force close
    setTimeout(this._onReconnect.bind(this), this.settings.reconnectTimeout);
  }
};

ITMP.prototype._onMessage = function (evt) {
  try {
    var msg = this._unserialize(evt.data);
  } catch (e) {
    console.error('Unserialize ITMP error', evt.data)
    return;
  }
  var code = msg[0],
    reqId = msg[1],
    topic = msg[2],
    payload = msg[3];

  if (code === COMMAND.ERROR) {
    this._calls[reqId] && this._calls[reqId].onError && this._calls[reqId].onError(payload);
    delete this._calls[reqId];
    return;
  }

  if (code === COMMAND.EVENT) {
    if (this._subs[topic]) {
      this._subs[topic].forEach(function (c) {
        c && c.onEvent && c.onEvent(topic, payload);
      });
    }
  } else {
    this._calls[reqId] && this._calls[reqId].onSuccess && this._calls[reqId].onSuccess(topic, payload); // it is answer and "payload" ocupied "topic" place
    delete this._calls[reqId];
  }
};

ITMP.prototype._onError = function (evt) {
  this.settings.onError(evt);
};

ITMP.prototype._onReconnect = function () {
  if (this._ws && this._ws.readyState !== WebSocket.CLOSED) {
    return;
  }

  this.reconnectCount += 1;
  this.settings.onReconnect();
  this.connect();
};

ITMP.prototype._send = function (message) {
  if (message) {
    this._messageQueue.push(this._serialize(message));
  }

  if (this._ws && this._ws.readyState === WebSocket.OPEN) {
    while (this._messageQueue.length) {
      this._ws.send(this._messageQueue.shift());
    }
  }
};




ITMP.prototype._getReqId = function () {
  return ++this.reqIdCount;
};

ITMP.prototype._serialize = function (msg) {
  if (this.settings.binaryType) {
    return CBOR.encode(msg);
  }
  return JSON.stringify(msg);
};

ITMP.prototype._unserialize = function (msg) {
  if (this.settings.binaryType) {
    return CBOR.decode(msg);
  }
  return JSON.parse(msg);
};

export default new ITMP()