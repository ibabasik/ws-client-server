/**
 * Created by Dmitry on 06/07/16.
 */
import pull from 'lodash/pull';
import forEach from 'lodash/forEach';
import isFunction from 'lodash/isFunction';
import isString from 'lodash/isString';
import isError from 'lodash/isError';
import isUndefined from 'lodash/isUndefined';
import clone from 'lodash/clone';

import WsError from './WsError';

const _ = {
    pull: pull,
    forEach: forEach,
    isFunction: isFunction,
    isString: isString,
    isError: isError,
    isUndefined: isUndefined,
    clone: clone
};

const error = console.error.bind(console),
    log = console.log.bind(console);

function WsClient() {
    this._msgId = 0;
    this._isConnected = false;
    this._handleEvents = true;

    this._replyMap = {};
    this._eventMap = {};
    this._eventQueue = [];

    this._nativeEventHandlers = {};
}

WsClient.prototype.on = function (eventName, handler) {
    let handlers = this._nativeEventHandlers[eventName];

    if (!handlers) {
        handlers = this._nativeEventHandlers[eventName] = [];
    }

    handlers.push(handler);
};

WsClient.prototype.once = function (eventName, handler){
    const self = this;

    let handlers = this._nativeEventHandlers[eventName];

    if (!handlers) {
        handlers = this._nativeEventHandlers[eventName] = [];
    }

    const newHandler = function () {
        _.pull(self._nativeEventHandlers[eventName], newHandler);
        handler.apply(null, arguments);
    };

    handlers.push(newHandler);
};

WsClient.prototype.off = function (eventName, handler) {
    _.pull(this._nativeEventHandlers[eventName], handler);
};

WsClient.prototype.emit = function (eventName, data) {
    const handlers = _.clone(this._nativeEventHandlers[eventName]);
    _.forEach(handlers, function (handler) {
        if (typeof(handler) === 'function'){
            handler(data);
        } else {
            console.error('handler is not a function');
        }

    });
};

WsClient.prototype.say = function (eventName, data) {
    data = data || {};

    const id = ++this._msgId;
    return this._safeSend({id: id, name: eventName, data: data});
};

WsClient.prototype.ask = function (eventName, data) {
    const self = this;

    data = data || {};

    const id = ++self._msgId;

    return new Promise(function (resolve, reject) {
        self._safeSend({id: id, name: eventName, data: data});
        self._replyMap[id] = {resolve: resolve, reject: reject};
    });
};

WsClient.prototype.offEvent = function(eventName){

    delete this._eventMap[eventName];

};

WsClient.prototype._onEvent = function (eventName, handler, isAsk) {
    const self = this;

    if (!_.isFunction(handler)) {
        error('handler is not function');
        throw new Error("handler is not function")
    }

    let eventHandler = self._eventMap[eventName];

    if (eventHandler) {
        error("HANDLER ALREADY EXISTS FOR '{eventName}'!".format({eventName: eventName}));
        return;
    }

    eventHandler = function (msg) {
        const msgId = msg.id;
        const data = msg.data;

        try {
            const result = handler(data);

            if (isAsk) {
                self._safeSend({ok: true, replyTo: msgId, data: result});
            }

            self._handleEventQueue();
        } catch (err) {
            let errorMsg = null;

            if (_.isString(err)) {
                errorMsg = err;
                error(err);
            } else if (_.isError(err)) {
                errorMsg = "Internal main error.";
                error(err.stack);
            } else {
                errorMsg = err.toString();
                error(err);
            }

            if (isAsk) {
                self._safeSend({ok: false, replyTo: msgId, error: errorMsg});
            }
        } finally {
            self._handleEventQueue();
        }
    };

    self._eventMap[eventName] = eventHandler;
};

WsClient.prototype.onSay = function (eventName, handler) {
    this._onEvent(eventName, handler);
};

WsClient.prototype.onAsk = function (eventName, handler) {
    this._onEvent(eventName, handler, true);
};

WsClient.prototype.close = function () {
    this._socket.close.apply(this._socket, arguments);
};

WsClient.prototype.startHandleEvents = function () {
    this._handleEvents = true;
    this._handleEventQueue();
};

WsClient.prototype.stopHandleEvents = function () {
    this._handleEvents = false;
};

WsClient.prototype.isConnected = function () {
    return this._isConnected;
};

WsClient.prototype.url = function () {
    return url.parse(this._socket.upgradeReq.url, true);
};

WsClient.prototype.connect = function (wsUrl) {
    const self = this;

    try {
        this._connectionString = wsUrl;
        this._socket = new WebSocket(wsUrl);

        this._initWebSocket();

        return new Promise(function (resolve, reject) {
            self.once('open', resolve);
            self.once('close', reject);
        });
    } catch (e) {
        return Promise.reject();
    }
};

WsClient.prototype._initWebSocket = function () {
    const self = this;

    if (self._connectionString) {
        self._socket.onopen = function () {
            log('ws connected to {_connectionString}'.format(self));

            self._isConnected = true;
            self._wasOpen = true;
            self.emit('open');
        };
    } else {
        self._wasOpen = true;
    }

    self._socket.onclose = function (event) {
        const closeCode = event.code;
        const reason = event.reason;

        log('ws disconnected: {closeCode} {reason}'.format({closeCode: closeCode, reason: reason}));

        self._isConnected = false;

        //очищаем очередь callbackQueue
        _.forEach(self.callbackQueue, function (obj, key) {
            obj.reject();
        });

        if (self._wasOpen) {
            self._wasOpen = false;

            self.emit('close', {
                closeCode: closeCode,
                reason: reason
            });
        }

        if (closeCode === 1000 && reason === "SESSIONID_NOT_VALID") {
            return;
        }

        if (self._connectionString) {
            setTimeout(function () {
                self.connect(self._connectionString);
            }, 1000);
        }
    };

    self._socket.onerror = function (error) {
        log('ws error: ' + error);
    };

    self._socket.onmessage = function (event) {
        const msg = event.data;
        log('IN: {msg}'.format({msg: msg}));

        self._eventQueue.push(msg);

        if (self._eventQueue.length === 1) {
            self._handleEventQueue(msg);
        }
    };
};

WsClient.prototype._safeSend = function (data) {
    const self = this;

    try {
        const str = JSON.stringify(data);
        const ws = self._socket;

        log("OUT: {str}".format({str: str}));

        ws.send(str);
    } catch (e) {
        console.error("Fail send: " + e.stack);
    }
};

WsClient.prototype._handleEventQueue = function () {
    const self = this;

    if (!self._handleEvents || self._eventQueue.length === 0) {
        return;
    }

    let msg = self._eventQueue.shift();

    try {
        msg = JSON.parse(msg);
    } catch (e) {
        error("FAKE PROTOCOL");

        self._safeSend({ok: false, replyTo: msg.id, error: 'Wrong JSON'});
        //.then(() => self._socket.close(1000, "Wrong protocol"));

        return;
    }

    if (msg.replyTo) {
        const obj = self._replyMap[msg.replyTo];
        delete self._replyMap[msg.replyTo];

        if (_.isUndefined(obj)) {
            error('The handler for msg not found: #{replyTo}'.format({replyTo: msg.replyTo}));
            //self._socket.close(1000, 'Wrong protocol');
        } else {
            if (msg.ok) {
                obj.resolve(msg.data);
            } else {
                obj.reject(new WsError(msg.error, msg.errorMsg));
            }
        }
    } else {
        const eventHandler = self._eventMap[msg.name];

        if (!eventHandler) {
            console.error({
                ok: false,
                replyTo: msg.id,
                error: 'Event "{name}" is not exists'.format({name: msg.name})
            });
        } else {
            eventHandler(msg);
        }
    }
};

export default WsClient;

