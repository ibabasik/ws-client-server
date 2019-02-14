const { expect } = require('chai'),
	EventEmitter = require('events'),
	{ WsClient, WsServer } = require('../index'),
	{ AppError, ERROR } = require('../src/errorCodes');

describe('ws-client-server', function () {
	const testAutoPingInterval = 5000;
	const server = new WsServer({ port: 63456, autoPingInterval: testAutoPingInterval });

	it('WsServer constructor should return WsServer instance and be EventEmitter', function () {
		expect(server).to.be.an.instanceOf(WsServer);
		expect(server).to.be.an.instanceOf(EventEmitter);
	});

	let serverSocket = null;

	server.on('connection', function (ws) {
		serverSocket = ws;

		ws.setInterceptor(function ({ eventName, data }) {
			if (eventName === 'getCurrentTime') {
				return new Date();
			} else if (eventName === 'magicNumber') {
				return 42;
			} else if (eventName === 'catch-error-string') {
				throw 'String error!';
			} else if (eventName === 'catch-error') {
				throw new Error('Error type!');
			} else if (eventName === 'catch-app-error') {
				throw new AppError('TEST_ERROR', 'AppError type!', { a: 42 });
			} else if (eventName === 'catch-error-number') {
				throw 67;
			}

			//console.log(`eventName: ${eventName}, data: ${JSON.stringify(data)}`);
			return { ok: 1 };
		});
	});

	const client = new WsClient();

	before(function (done) {
		client.connect('ws://localhost:63456');
		client.once('open', done);
	});

	after(function () {
		server.close();
		client.close();
	});

	it('clients length should be 1', function () {
		expect(server.clients.length).to.equal(1);
	});

	it('client should ask server for time', async () => {
		const time = await client.ask('getCurrentTime');
		const a = Date.parse(time);
		const diff = new Date() - a;

		if (!(diff < 2 * 1000)) {
			new Error('Not ok');
		}
	});

	it('server should be able to broadcast message', function (done) {
		client.onSay('magicNumber', number => {
			expect(number).to.equal(42);
			done();
		});

		server.broadcast('magicNumber', 42);
	});

	it('server pings client', function (done) {
		server.clients[0].on('pong', done);
		server.clients[0].ping();
	});


	it('server catches internal error by string type', async () => {
		try {
			await client.ask('catch-error-string');
		} catch (e) {
			expect(e).to.be.an('error');
			expect(e.message).to.equal('String error!');
		}
	});

	it('server catches internal error by Error type', async () => {
		try {
			await client.ask('catch-error');
		} catch (e) {
			expect(e).to.be.an('error');
			expect(e.message).to.be.an.equal('INTERNAL_SERVER_ERROR');
		}
	});

	it('server catches internal error by AppError type', async () => {
		try {
			await client.ask('catch-app-error');
		} catch (e) {
			expect(e).to.be.an('error');
			expect(e.message).to.equal('TEST_ERROR');
			expect(e.description).to.equal('AppError type!');
			expect(e.data).to.deep.equal({ a: 42 });
		}
	});

	it('server catches internal error by number type', async () => {
		try {
			await client.ask('catch-error-number');
		} catch (e) {
			expect(e).to.be.an('error');
			expect(e.message).to.equal('67');
		}
	});

	it('server catches non-JSON messages', async () => {
		await client.send
	});

	it('client may close', function (done) {
		server.on('connection-closed', () => {
			expect(server.clients.length).to.equal(0);
			done();
		});

		client.close();
	});
});