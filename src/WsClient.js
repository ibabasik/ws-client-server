/**
 * Created by Dmitry on 06/07/16.
 */
const _ = require('lodash'),
	url = require('url'),
	EventEmitter = require('events').EventEmitter,
	WebSocket = require('ws'),
	intel = require('intel'),
	{ AppError, ERROR } = require('./errorCodes'),
	logger = intel.getLogger('wsClient').setLevel(intel.DEBUG),
	uuid = require('uuid');

class WsClient extends EventEmitter {
	constructor() {
		super();

		this.uuid = uuid.v4();
		this._msgId = 0;
		this._isConnected = false;
		this._handleEvents = true;

		this._interceptor = null;
		this._replyMap = new Map();
		this._eventMap = new Map();
		this._eventQueue = [];
	}

	static fromWebsocket(nativeWs, req) {
		let client = new WsClient();

		client._socket = nativeWs;
		client._upgradeReq = req;
		client._initWebSocket();

		return client;
	}

	setInterceptor(interceptor) {
		this._interceptor = interceptor;
	}

	emit(...args) {
		if (args[0] !== 'open' && args[0] !== 'close' && args[0] !== 'pong') {
			logger.error(`WHAT THE FUCKING EMIT! ${ JSON.stringify(args) }`);
		}

		super.emit(...args);
	}

	say(eventName, data = {}) {

		return this._safeSend({ name: eventName, data: data })
			.catch(err => logger.error(err.stack));
	}

	ask(eventName, data = {}) {
		let id = ++this._msgId;

		let stack = new Error().stack;

		let p = new Promise((resolve, reject) => {
			this._replyMap.set(id, { resolve, reject, stack });
		});

		return this._safeSend({ id: id, name: eventName, data: data })
			.then(() => p);
	}

	_onEvent(eventName, handler) {
		if (!_.isFunction(handler)) {
			logger.error('handler is not function');
			throw new Error('handler is not function');
		}

		let eventHandler = this._eventMap.get(eventName);

		if (eventHandler) {
			logger.error(`HANDLER ALREADY EXISTS FOR '${eventName}'!`);
			return;
		}

		this._eventMap.set(eventName, handler);
	}

	onSay(eventName, handler) {
		this._onEvent(eventName, handler);
	}

	onAsk(eventName, handler) {
		this._onEvent(eventName, handler, true);
	}

	close(...args) {
		this._socket.close(...args);
	}

	terminate(){
		this._socket.terminate();
	}

	startHandleEvents() {
		this._handleEvents = true;
		this._handleEventQueue();
	}

	stopHandleEvents() {
		this._handleEvents = false;
	}

	get isConnected() {
		return this._isConnected;
	}

	get url() {
		return url.parse(this._upgradeReq.url, true);
	}

	get host() {
		return this._upgradeReq.headers.host;
	}

	get clientAddress() {
		const conn = this._upgradeReq.connection;
		return { ip: conn.remoteAddress, family: conn.remoteFamily, port: conn.remotePort };
	}

	connect(connectionString) {
		this._connectionString = connectionString;
		this._socket = new WebSocket(connectionString);

		this._initWebSocket();

		return this;
	}

	heartbeat() {
		clearTimeout(this.pingTimeout);

		// Use `WebSocket#terminate()` and not `WebSocket#close()`. Delay should be
		// equal to the interval at which your server sends out pings plus a
		// conservative assumption of the latency.
		this.pingTimeout = setTimeout(() => {
			console.log('Server not alive, terminating');
			this._socket.terminate();
		}, 30000 + 1000);
	}

	_initWebSocket() {
		if (this._connectionString) {
			this._socket.on('open', () => {
				logger.verbose(`Socket ${this.uuid} connected to ${this._connectionString}`);

				this._isConnected = true;
				this._wasOpen = true;
				this.emit('open');
				this.heartbeat();
			});
		} else {
			this._wasOpen = true;
		}

		this._socket.on('close', event => {
			logger.verbose(`Socket ${this.uuid} disconnected`);

			clearTimeout(this.pingTimeout);

			const { code, reason } = event;

			this._isConnected = false;

			//очищаем очередь callbackQueue
			_.forEach(this.callbackQueue, obj => obj.reject());

			if (this._wasOpen) {
				this._wasOpen = false;

				this.emit('close', code, reason);
			}

			if (this._connectionString) {
				setTimeout(() => this.connect(this._connectionString), 1000);
			}
		});

		this._socket.on('error', error => {
			logger.verbose('WebSocket error: ' + error);

			if (this._connectionString) {
				setTimeout(() => this.connect(this._connectionString), 1000);
			}
		});

		this._socket.on('message', msg => {
			logger.verbose(`IN ${ this.uuid }: ${msg}`);

			this._eventQueue.push(msg);

			if (this._eventQueue.length === 1) {
				this._handleEventQueue(msg);
			}
		});

		this._socket.on('pong', () => {
			this.emit('pong');
		});

		this._socket.on('ping', () => {
			this.heartbeat();
			//console.log('Client received ping');
			//this._socket.send('pong');
		});

	}

	_safeSend(data) {
		return new Promise((resolve, reject) => {
			let str = JSON.stringify(data);
			let ws = this._socket;

			const logJson = str;//.length < 50 ? str : str.substring(0, 50) + '[...]';
			logger.verbose(`OUT ${ this.uuid }: ${logJson}`);

			ws.send(str, function (err) {
				if (err) {
					logger.error(`${ ws._id }: Fail async: ${ err }!`);
					reject(err);
				}

				resolve();
			});
		});
	}

	async _handleEventQueue() {
		if (!this._handleEvents || this._eventQueue.length === 0) {
			return;
		}

		const self = this,
			interceptor = this._interceptor;

		let msg = this._eventQueue.shift();

		try {
			msg = JSON.parse(msg);
		} catch (e) {
			logger.error('FAKE PROTOCOL');

			this._safeSend({ ok: 0, replyTo: msg.id, error: 'Wrong JSON' });
			//.then(() => this._socket.close(1000, "Wrong protocol"));

			return;
		}

		if (msg.replyTo) {
			let obj = this._replyMap.get(msg.replyTo);
			this._replyMap.delete(msg.replyTo);

			if (_.isUndefined(obj)) {
				logger.error(`${ this.uuid }: The handler for msg not found: #${msg.replyTo}`);
				//this._socket.close(1000, 'Wrong protocol');
			} else {
				if (msg.ok) {
					obj.resolve(msg.data);
				} else {
					let err = new Error(msg.error);
					logger.error(err);
					obj.reject(err);
				}
			}
		} else {
			const { id: msgId, data } = msg,
				handler = this._eventMap.get(msg.name);


			try {
				let result;

				if (!interceptor && handler) {
					result = await handler(data);
				} else if (interceptor) {
					result = await interceptor({ eventName: msg.name, data: msg.data });
				} else {
				    throw new AppError(ERROR.EVENT_NOT_EXISTS, 'Обработчик этого метода не существует');
				}

				if (msgId) {
					await self._safeSend({ ok: 1, replyTo: msgId, data: result });
				}

				self._handleEventQueue();
			} catch (err) {
				let errorCode = null,
					errorDescription = undefined,
					errorData = null;

				if (_.isString(err)) {
					errorCode = err;
					logger.error(err);
				} else if (_.isError(err)) {
					errorCode = err.name || err.code || ERROR.INTERNAL_SERVER_ERROR;
					errorDescription = err.message;
					errorData = err.data;
					if (err.name === 'ArangoError') {
						logger.error(err.message, err.stack);
					} else {
						logger.error(err);
					}
				} else {
					errorCode = err.toString();
					logger.error(err);
				}

				if (msgId) {
					self._safeSend({ ok: 0, replyTo: msgId, error: errorCode, errorMsg: errorDescription, errorData: errorData });
				}

				self._handleEventQueue();
			}
		}
	}

	ping(){
		this._socket.ping();
	}

}

module.exports = WsClient;
