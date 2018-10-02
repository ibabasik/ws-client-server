function WsError(name, message){
    this.name = name;
    this.message = message;
	this.data = data;
}
WsError.prototype = Error.prototype;

export default WsError;
