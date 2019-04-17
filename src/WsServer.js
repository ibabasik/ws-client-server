const _ = require('lodash'),
	WebSocket = require('ws'),
	EventEmitter = require('events').EventEmitter,
	MyClient = require('./WsClient');

class WsServer extends EventEmitter {
	constructor({ server, port, autoPingInterval = 30 * 1000 } = {}) {
		super();

		this.clients = [];
		this._initSocketServer({ server, port });

		this._autoPingInterval = setInterval(() => {
			for (const ws of this.clients) {
				if (ws.isAlive === false) {
					console.log('Client not alive, terminating');
					ws.terminate();
					continue;
				}

				ws.isAlive = false;
				ws.ping();
				//console.log('Server sent ping');
			}
		}, autoPingInterval);
	}

	_initSocketServer({ server, port }) {
		this._socketServer = new WebSocket.Server({ server, port });

		this._socketServer.on('connection', (nativeWs, req) => {
			let ws = MyClient.fromWebsocket(nativeWs, req);
			this.clients.push(ws);

			ws.isAlive = true;
			ws.on('pong', () => {
				ws.isAlive = true;
				//console.log('Server received pong');
			});

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
		clearInterval(this._autoPingInterval);
		this._socketServer.close(...args);
	}
}

module.exports = WsServer;