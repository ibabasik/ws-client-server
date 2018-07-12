UWS Server and Client Wrappers
----------------------------------------------------------------

Provides two classes:

* WsServer({ server, port })

    WsServer wraps native WebSocket.Server. It stores connected
    clients in clients array and fires 'connection' event on
    every connected client and wraps it in WsClient. 
    On client disconnect it removes it from clients array.
* WsClient()

    WsClient wraps native WebSocket and provides a way to 
    use it like socket.io (with promises)
    * Methods:
        * setInterceptor
        * say(eventName, data = {}) - send message to server 
        without waiting for response
        * ask(eventName, data = {}) -> Promise - send message 
        to server with response 
        * on(eventName, handler) - subscribe to system events
        like 'open' or 'close'
        * onSay(eventName, handler) - subscribe to custom events
        like server broadcast
        * onAsk - same as onSay for now
        * close - disconnect from server
        * connect(connectionString) - connect to server
