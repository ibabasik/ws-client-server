const _ = require('lodash'),
	WebSocket = require('ws'),
	EventEmitter = require('events').EventEmitter,
	MyClient = require('./WsClient');

function noop() {}

class WsServer extends EventEmitter {
	constructor({ server, port }) {
		super();

		this.clients = [];
		this._initSocketServer({ server, port });
		const interval = setInterval(() => {
			for (const ws of this.clients) {
				if (ws.isAlive === false) {
					console.log('Client not alive, terminating');
					ws.terminate();
					continue;
				}
				ws.isAlive = false;
				ws.ping(noop);
				//console.log('Server sent ping');
			}
		}, 30000);
	}

	_initSocketServer({ server, port }) {
		this._socketServer = new WebSocket.Server({ server, port });
		//this._socketServer.startAutoPing(30 * 1000);

		this._socketServer.on('connection', nativeWs => {
			let ws = MyClient.fromWebsocket(nativeWs);
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
		this._socketServer.close(...args);
	}
}

module.exports = WsServer;