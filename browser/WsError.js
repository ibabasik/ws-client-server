function WsError(name, message){
    this.name = name;
    this.message = message;
}
WsError.prototype = Error.prototype;

export default WsError;
