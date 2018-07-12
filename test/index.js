const { expect } = require('chai'),
    EventEmitter = require('events'),
    { WsClient, WsServer } = require('../index');

describe('ws-client-server', function () {

    const server = new WsServer({ port: 63456 });

    it('WsServer constructor should return WsServer instance and be EventEmitter', function () {
        expect(server).to.be.an.instanceOf(WsServer);
        expect(server).to.be.an.instanceOf(EventEmitter);
    });

    server.on('connection', function (ws) {

        ws.setInterceptor(function ({ eventName, data}) {
            //console.log(`eventName: ${eventName}, data: ${JSON.stringify(data)}`);
            return { ok: 1 };
        })

    });

    let client;
    it('client should connect', function (done) {
        client = new WsClient();
        client.once('open', done);
        client.once('error', done);
        client.connect('ws://localhost:63456');
    })

    it('clients length should be 1', function () {
        expect(server.clients.length).to.equal(1);
    })

    it('client should ask server for time', function (done) {
        client.ask('getCurrentTime').then(({ ok }) => {
            if (!ok){
                return done(new Error('Not ok'));
            }
            done();
        }, done);
    })

    it('server should be able to broadcast message', function (done) {
        client.onSay('magicNumber', (number) => {
            expect(number).to.equal(2);
            done();
        })
        server.broadcast('magicNumber', 2);
    })

    it('client may close', function (done) {
        server.on('connection-closed', () => {
            expect(server.clients.length).to.equal(0);
            done();
        })
        client.close();
    })

});