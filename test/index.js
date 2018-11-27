const { expect } = require('chai'),
	EventEmitter = require('events'),
	{ WsClient, WsServer } = require('../index');

describe('ws-client-server', function () {
	const testAutoPingInterval = 5000;
	const server = new WsServer({ port: 63456, autoPingInterval: testAutoPingInterval });

	it('WsServer constructor should return WsServer instance and be EventEmitter', function () {
		expect(server).to.be.an.instanceOf(WsServer);
		expect(server).to.be.an.instanceOf(EventEmitter);
	});

	server.on('connection', function (ws) {
		ws.setInterceptor(function ({ eventName, data}) {
			//console.log(`eventName: ${eventName}, data: ${JSON.stringify(data)}`);
			return { ok: 1 };
		});
	});

	const client = new WsClient();

	before(function(done){
		client.connect('ws://localhost:63456');
		client.once('open', done);
	});

	after(function(){
		server.close();
		client.close();
	});

	it('clients length should be 1', function () {
		expect(server.clients.length).to.equal(1);
	});

	it('client should ask server for time', function (done) {
		client.ask('getCurrentTime').then(({ ok }) => {
			if (!ok){
				return done(new Error('Not ok'));
			}

			done();
		}, done);
	});

	it('server should be able to broadcast message', function (done) {
		client.onSay('magicNumber', number => {
			expect(number).to.equal(42);
			done();
		});

		server.broadcast('magicNumber', 42);
	});

	/*it('server and client should ping each other', function (done) {
	     setTimeout(() => {
	         expect(server.clients.length).to.equal(1);
	         done();
	     }, 10*1000);
	 });*/

	it('server pings client', function (done) {
		server.clients[0].on('pong', a => {
			done();
		});

		server.clients[0].ping();
	});

	it('client may close', function (done) {
		server.on('connection-closed', () => {
			expect(server.clients.length).to.equal(0);
			done();
		});

		client.close();
	});
});