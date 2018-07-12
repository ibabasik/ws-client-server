const _ = require('lodash'),
	WebSocket = require('uws'),
	EventEmitter = require('events').EventEmitter,
	MyClient = require('./WsClient');

class WsServer extends EventEmitter {
	constructor({ server, port }) {
		super();

		this.clients = [];
		this._initSocketServer({ server, port });
	}

	_initSocketServer({ server, port }) {
		this._socketServer = new WebSocket.Server({ server, port });
		this._socketServer.startAutoPing(30 * 1000);

		this._socketServer.on('connection', nativeWs => {
			let ws = MyClient.fromWebsocket(nativeWs);
			this.clients.push(ws);

			ws.on('close', () => {
				_.pull(this.clients, ws);
				this.emit('connection-closed', ws);
			});

			this.emit('connection', ws);
		});

		this._socketServer.on('close', () => {
			this.clients = [];
		});
	}

	broadcast(eventName, data) {
		for (const w of this.clients) {
			w.say(eventName, data);
		}
	}

	close(...args) {
		this._socketServer.close(...args);
	}
}

module.exports = WsServer;