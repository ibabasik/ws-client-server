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

var _ = {
	pull: pull,
	forEach: forEach,
	isFunction: isFunction,
	isString: isString,
	isError: isError,
	isUndefined: isUndefined,
	clone: clone
};


if (!String.prototype.format) {
	String.prototype.format = function () {
		var str = this.toString();

		if (!arguments.length) {
			return str;
		}

		var argType = typeof arguments[0];
		var args = (('string' === argType || 'number' === argType) ? arguments : arguments[0]);

		for (var arg in args) {
			str = str.replace(new RegExp('\\{' + arg + '\\}', 'gi'), args[arg]);
		}

		return str;
	};
}

// var error = console.error.bind(console),
//     log = console.log.bind(console);

function WsClient(options) {
	options = options || {};
	this._msgId = 0;
	this._isConnected = false;
	this._handleEvents = true;

	this._replyMap = {};
	this._eventMap = {};
	this._eventQueue = [];

	var logLevels = {
		error: 0,
		info: 1,
		debug: 2,
		verbose: 3
	};

	this._nativeEventHandlers = {};
	this._logLevel = logLevels[options.logLevel || 'info'];
	var self = this;
	this.debug = function () {
		if (self._logLevel >= logLevels.debug) {
			var args = ['DEBUG:'].concat(Array.prototype.slice.call(arguments, 0));
			console.log.apply(console, args);
		}
	};
	this.error = function () {
		if (self._logLevel >= logLevels.error) {
			console.error.apply(console, arguments);
		}
	};
	this.info = function () {
		if (self._logLevel >= logLevels.info) {
			var args = ['INFO:'].concat(Array.prototype.slice.call(arguments, 0));
			console.log.apply(console, args);
		}
	};
	this.verbose = function () {
		if (self._logLevel >= logLevels.verbose) {
			var args = ['VERBOSE:'].concat(Array.prototype.slice.call(arguments, 0));
			console.log.apply(console, args);
		}
	};
}

WsClient.prototype.on = function (eventName, handler) {
	var handlers = this._nativeEventHandlers[eventName];

	if (!handlers) {
		handlers = this._nativeEventHandlers[eventName] = [];
	}

	handlers.push(handler);
};

WsClient.prototype.once = function (eventName, handler) {
	var self = this;

	var handlers = this._nativeEventHandlers[eventName];

	if (!handlers) {
		handlers = this._nativeEventHandlers[eventName] = [];
	}

	var newHandler = function () {
		_.pull(self._nativeEventHandlers[eventName], newHandler);
		handler.apply(null, arguments);
	};

	handlers.push(newHandler);
};

WsClient.prototype.off = function (eventName, handler) {
	_.pull(this._nativeEventHandlers[eventName], handler);
};

WsClient.prototype.emit = function (eventName, data) {
	var handlers = _.clone(this._nativeEventHandlers[eventName]);
	var self = this;
	_.forEach(handlers, function (handler) {
		if (typeof (handler) === 'function') {
			handler(data);
		} else {
			self.error('handler is not a function');
		}

	});
};

WsClient.prototype.say = function (eventName, data) {
	data = data || {};
	return this._safeSend({ name: eventName, data: data });
};

WsClient.prototype.ask = function (eventName, data) {
	var self = this;

	data = data || {};

	var id = ++self._msgId;

	return new Promise(function (resolve, reject) {
		self._safeSend({ id: id, name: eventName, data: data });
		self._replyMap[id] = { resolve: resolve, reject: reject };
	});
};

WsClient.prototype.offEvent = function (eventName) {

	delete this._eventMap[eventName];

};

WsClient.prototype._onEvent = function (eventName, handler, isAsk) {
	var self = this;

	if (!_.isFunction(handler)) {
		self.error('handler is not function');
		throw new Error('handler is not function');
	}

	var eventHandler = self._eventMap[eventName];

	if (eventHandler) {
		self.error('HANDLER ALREADY EXISTS FOR \'{eventName}\'!'.format({ eventName: eventName }));
		return;
	}

	eventHandler = function (msg) {
		var msgId = msg.id;
		var data = msg.data;

		try {
			var result = handler(data);

			if (isAsk) {
				self._safeSend({ ok: true, replyTo: msgId, data: result });
			}

			self._handleEventQueue();
		} catch (err) {
			var errorMsg = null;

			if (_.isString(err)) {
				errorMsg = err;
				self.error(err);
			} else if (_.isError(err)) {
				errorMsg = 'Internal main error.';
				self.error(err.stack);
			} else {
				errorMsg = err.toString();
				self.error(err);
			}

			if (isAsk) {
				self._safeSend({ ok: false, replyTo: msgId, error: errorMsg });
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
	var self = this;

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

// WsClient.prototype.heartbeat = function () {
// 	clearTimeout(this.pingTimeout);
//
// 	// Use `WebSocket#terminate()` and not `WebSocket#close()`. Delay should be
// 	// equal to the interval at which your server sends out pings plus a
// 	// conservative assumption of the latency.
// 	this.pingTimeout = setTimeout(() => {
// 		console.log('Server not alive, terminating');
// 		this._socket.terminate();
// 	}, 30000 + 1000);
// }

WsClient.prototype._initWebSocket = function () {
	var self = this;

	if (self._connectionString) {
		self._socket.onopen = function () {
			//log('ws connected to {_connectionString}'.format(self));
			self.info('ws connected to {_connectionString}'.format(self));

			self._isConnected = true;
			self._wasOpen = true;
			self.emit('open');

			//self.heartbeat();
		};
	} else {
		self._wasOpen = true;
	}

	self._socket.onclose = function (event) {
		var closeCode = event.code;
		var reason = event.reason;

		self.info('ws disconnected: {closeCode} {reason}'.format({ closeCode: closeCode, reason: reason }));

		//clearTimeout(self.pingTimeout);

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

		if (closeCode === 1000 && reason === 'SESSIONID_NOT_VALID') {
			return;
		}

		if (self._connectionString) {
			setTimeout(function () {
				self.connect(self._connectionString);
			}, 1000);
		}
	};

	self._socket.onerror = function (error) {
		self.error('ws error: ' + error);
	};

	self._socket.onmessage = function (event) {
		var msg = event.data;
		self.debug('IN: {msg}'.format({ msg: msg }));

		self._eventQueue.push(msg);

		if (self._eventQueue.length === 1) {
			self._handleEventQueue(msg);
		}
	};
};

WsClient.prototype._safeSend = function (data) {
	var self = this;

	try {
		var str = JSON.stringify(data);
		var ws = self._socket;

		self.debug('OUT: {str}'.format({ str: str }));

		ws.send(str);
	} catch (e) {
		self.error('Fail send: ' + e.stack);
	}
};

WsClient.prototype._handleEventQueue = function () {
	var self = this;

	if (!self._handleEvents || self._eventQueue.length === 0) {
		return;
	}

	var msg = self._eventQueue.shift();

	try {
		msg = JSON.parse(msg);
	} catch (e) {
		self.error('FAKE PROTOCOL');

		self._safeSend({ ok: false, replyTo: msg.id, error: 'Wrong JSON' });
		//.then(() => self._socket.close(1000, "Wrong protocol"));

		return;
	}

	if (msg.replyTo) {
		var obj = self._replyMap[msg.replyTo];
		delete self._replyMap[msg.replyTo];

		if (_.isUndefined(obj)) {
			self.error('The handler for msg not found: #{replyTo}'.format({ replyTo: msg.replyTo }));
			//self._socket.close(1000, 'Wrong protocol');
		} else {
			if (msg.ok) {
				obj.resolve(msg.data);
			} else {
				obj.reject(new WsError(msg.error, msg.errorMsg, msg.errorData));
			}
		}
	} else {
		var eventHandler = self._eventMap[msg.name];

		if (!eventHandler) {
			self.error({
				ok: false,
				replyTo: msg.id,
				error: 'Event "{name}" is not exists'.format({ name: msg.name })
			});
		} else {
			eventHandler(msg);
		}
	}
};

WsClient.prototype.ping = function () {
	this._socket.ping();
};

WsClient.prototype.terminate = function () {
	this._socket.terminate();
};

export default WsClient;
